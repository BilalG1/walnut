import { describe, expect, test } from 'bun:test'
import {
  MAX_CONCURRENT_QUERIES_PER_BRANCH,
  QUERY_LIMITS,
  RATE_LIMITS,
  type RateLimitName,
  RESOURCE_LIMITS,
  SYSTEM_USER_ID,
} from '@walnut/core'
import { agents, branches, projects, scopeRequests } from '@walnut/db'
import { and, eq } from 'drizzle-orm'
import { bearer, type ErrorBody, h, newAgent, newProject, personalOrgId, useHarness } from './support.ts'

useHarness()

describe('resource limits', () => {
  // Each cap is checked with a COUNT *before* any provider call, so we seed the metadata
  // rows directly to reach the ceiling cheaply (no real provisioning) and assert the API
  // refuses the over-the-limit create with a machine-readable 403 `limit_exceeded` body.

  test('projects per org is capped', async () => {
    const orgId = await personalOrgId()
    await h.ctx.db.insert(projects).values(
      Array.from({ length: RESOURCE_LIMITS.projectsPerOrg }, (_, i) => ({
        organizationId: orgId,
        name: `seed-${i}`,
        provider: 'local' as const,
        status: 'active' as const,
      })),
    )
    const res = await h.api.api.projects.post({ name: 'one-too-many' })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('projects_per_org')
    expect(body?.max).toBe(RESOURCE_LIMITS.projectsPerOrg)
  })

  test('branches per project is capped', async () => {
    const project = await newProject() // a real project; its main branch counts as 1
    await h.ctx.db.insert(branches).values(
      Array.from({ length: RESOURCE_LIMITS.branchesPerProject - 1 }, (_, i) => ({
        projectId: project.id,
        name: `seed-${i}`,
        isDefault: false,
        status: 'active' as const,
      })),
    )
    const res = await h.api.api.projects({ id: project.id }).branches.post({ name: 'overflow' })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('branches_per_project')
  })

  test('branches per org is capped across projects', async () => {
    const orgId = await personalOrgId()
    // Spread branches so no single project hits the per-project cap, but the org total does.
    const perProject = RESOURCE_LIMITS.branchesPerProject - 1
    const projCount = Math.ceil(RESOURCE_LIMITS.branchesPerOrg / perProject)
    const created = await h.ctx.db
      .insert(projects)
      .values(
        Array.from({ length: projCount }, (_, i) => ({
          organizationId: orgId,
          name: `p-${i}`,
          provider: 'local' as const,
          status: 'active' as const,
        })),
      )
      .returning({ id: projects.id })
    let remaining = RESOURCE_LIMITS.branchesPerOrg
    const branchRows: { projectId: string; name: string; isDefault: boolean; status: 'active' }[] = []
    for (const p of created) {
      const take = Math.min(perProject, remaining)
      for (let i = 0; i < take; i++) {
        branchRows.push({ projectId: p.id, name: `b-${p.id}-${i}`, isDefault: false, status: 'active' })
      }
      remaining -= take
    }
    await h.ctx.db.insert(branches).values(branchRows)
    // created[0] holds `perProject` (< the per-project cap) branches, so only the org cap trips.
    const target = created[0]
    if (target === undefined) throw new Error('no seeded project')
    const res = await h.api.api.projects({ id: target.id }).branches.post({ name: 'overflow' })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('branches_per_org')
  })

  test('agents per org is capped', async () => {
    const orgId = await personalOrgId()
    await h.ctx.db.insert(agents).values(
      Array.from({ length: RESOURCE_LIMITS.agentsPerOrg }, (_, i) => ({
        organizationId: orgId,
        name: `seed-${i}`,
        keyHash: `seed-hash-${i}`,
        keyPrefix: 'wln_agt_seed',
      })),
    )
    const res = await h.api.api.organizations({ orgId }).agents.post({ name: 'one-too-many' })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('agents_per_org')
  })

  test('pending scope requests per agent is capped', async () => {
    const orgId = await personalOrgId()
    const agent = await newAgent()
    await h.ctx.db.insert(scopeRequests).values(
      Array.from({ length: RESOURCE_LIMITS.pendingScopeRequestsPerAgent }, () => ({
        agentId: agent.id,
        organizationId: orgId,
        resourceType: 'project' as const,
        resourceId: crypto.randomUUID(),
        scopes: ['db:read' as const],
        status: 'pending' as const,
      })),
    )
    const res = await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('pending_scope_requests_per_agent')
  })
})

describe('query limits', () => {
  test('rejects an oversized SQL payload with 413 sql_too_large', async () => {
    await newProject()
    const agent = await newAgent()
    // The size check runs before classify/scope, so even a grant-less agent gets 413 (not 403).
    const huge = `-- ${'x'.repeat(QUERY_LIMITS.maxSqlBytes + 1)}\nSELECT 1`
    const res = await h.api.agent.v1.query.post({ sql: huge }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(413)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('sql_too_large')
  })

  test('truncates a result set past the row cap and flags it', async () => {
    const project = await newProject()
    const overBy = 5_000
    const total = QUERY_LIMITS.maxResultRows + overBy
    const res = await h.api.api
      .projects({ id: project.id })
      .sql.post({ sql: `SELECT g AS n FROM generate_series(1, ${total}) AS g` })
    expect(res.status).toBe(200)
    expect(res.data?.rows.length).toBe(QUERY_LIMITS.maxResultRows)
    expect(res.data?.rowCount).toBe(total) // the true count is preserved
    expect(res.data?.truncated).toBe(true)
  })

  test('truncates a wide result set past the byte cap and flags it', async () => {
    const project = await newProject()
    // 100 rows × ~200 KB each ≈ 20 MB, well over the byte ceiling — only a row prefix survives,
    // even though the row count (100) is far under the row cap.
    const res = await h.api.api
      .projects({ id: project.id })
      .sql.post({ sql: `SELECT repeat('x', 200000) AS big FROM generate_series(1, 100) AS g` })
    expect(res.status).toBe(200)
    expect(res.data?.truncated).toBe(true)
    expect(res.data?.rows.length).toBeLessThan(100)
    expect(res.data?.rowCount).toBe(100)
  }, 15_000)

  test('a normal small query is not flagged as truncated', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT 1 AS n' })
    expect(res.status).toBe(200)
    expect(res.data?.truncated).toBe(false)
    expect(res.data?.rows).toEqual([{ n: 1 }])
  })
})

describe('rate limits', () => {
  // Buckets/gauges are drained directly through the shared limiter (h.ctx.rateLimiter is the
  // same instance the middleware uses), then one real request proves the 429. The harness's
  // frozen clock keeps a drained bucket drained, and reset() clears it before the next test.
  function drain(name: RateLimitName, key: string): void {
    for (let i = 0; i < RATE_LIMITS[name].capacity; i++) {
      h.ctx.rateLimiter.take(name, key)
    }
  }

  test('agent query is rate-limited per agent', async () => {
    const agent = await newAgent()
    drain('agentQuery', agent.id)
    const res = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(429)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('rate_limited')
    expect(body?.limit).toBe('agentQuery')
  })

  test('normal traffic is not rate-limited', async () => {
    const agent = await newAgent()
    // A fresh bucket never 429s on the first call (it's a scope 403 here — but not rate-limited).
    const res = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })
    expect(res.status).not.toBe(429)
  })

  test('provisioning is rate-limited per user', async () => {
    drain('provisioningPerUser', SYSTEM_USER_ID)
    const res = await h.api.api.projects.post({ name: 'rl' })
    expect(res.status).toBe(429)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('rate_limited')
    expect(body?.limit).toBe('provisioningPerUser')
  })

  test('concurrent queries per branch are capped', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const [main] = await h.ctx.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.projectId, project.id), eq(branches.isDefault, true)))
    if (main === undefined) throw new Error('no main branch')
    // Hold every concurrency slot for the branch so the next query can't acquire one.
    for (let i = 0; i < MAX_CONCURRENT_QUERIES_PER_BRANCH; i++) {
      h.ctx.rateLimiter.acquire(`branch:${main.id}`, MAX_CONCURRENT_QUERIES_PER_BRANCH)
    }
    const res = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(429)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('too_many_concurrent_queries')
  })

  test('scope requests are rate-limited per agent', async () => {
    const agent = await newAgent()
    drain('scopeRequestPerAgent', agent.id)
    const res = await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(429)
    expect((res.error?.value as ErrorBody | undefined)?.limit).toBe('scopeRequestPerAgent')
  })

  test('key rotation is rate-limited per agent', async () => {
    const agent = await newAgent()
    drain('keyRotationPerAgent', agent.id)
    const res = await h.api.api.agents({ id: agent.id })['rotate-key'].post()
    expect(res.status).toBe(429)
    expect((res.error?.value as ErrorBody | undefined)?.limit).toBe('keyRotationPerAgent')
  })

  test('the dashboard SQL viewer is rate-limited per user', async () => {
    const project = await newProject()
    drain('dashboardQueryPerUser', SYSTEM_USER_ID)
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT 1' })
    expect(res.status).toBe(429)
    expect((res.error?.value as ErrorBody | undefined)?.limit).toBe('dashboardQueryPerUser')
  })

  test('the dashboard SQL viewer shares the per-branch concurrency cap', async () => {
    const project = await newProject()
    const [main] = await h.ctx.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.projectId, project.id), eq(branches.isDefault, true)))
    if (main === undefined) throw new Error('no main branch')
    // Hold every slot for the branch (the same gauge the agent query path uses).
    for (let i = 0; i < MAX_CONCURRENT_QUERIES_PER_BRANCH; i++) {
      h.ctx.rateLimiter.acquire(`branch:${main.id}`, MAX_CONCURRENT_QUERIES_PER_BRANCH)
    }
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT 1' })
    expect(res.status).toBe(429)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('too_many_concurrent_queries')
  })

  test('dashboard storage operations are rate-limited per user', async () => {
    const project = await newProject()
    drain('dashboardStoragePerUser', SYSTEM_USER_ID)
    const res = await h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.ls.get()
    expect(res.status).toBe(429)
    expect((res.error?.value as ErrorBody | undefined)?.limit).toBe('dashboardStoragePerUser')
  })
})
