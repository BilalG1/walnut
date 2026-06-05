import { describe, expect, test } from 'bun:test'
import { scopeSetKey } from '@walnut/core'
import { agentGrants, agentGrantScopes, branchDbRoles, branches } from '@walnut/db'
import { and, eq } from 'drizzle-orm'
import { bearer, type ErrorBody, grant, grantResource, h, newAgent, newProject, personalOrgId, useHarness } from './support.ts'

useHarness()

describe('agents', () => {
  test('POST /api/organizations/:orgId/agents creates an agent with no scopes and a key', async () => {
    const orgId = await personalOrgId()
    const res = await h.api.api.organizations({ orgId }).agents.post({ name: 'bot' })
    expect(res.status).toBe(200)
    expect(res.data?.name).toBe('bot')
    expect(res.data?.scopes).toEqual([])
    expect(res.data?.apiKey.startsWith('wln_agt_')).toBe(true)
    expect(res.data?.keyPrefix.startsWith('wln_agt_')).toBe(true)
  })

  test('creating an agent in an org the caller is not a member of is 404', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('77777777-7777-7777-7777-777777777777', { email: 'stranger7@example.com' })
    const res = await stranger.api.organizations({ orgId }).agents.post({ name: 'bot' })
    expect(res.status).toBe(404)
  })

  test('GET /api/agents/:id returns the agent (with an empty grant breakdown) and no key', async () => {
    const agent = await newAgent()
    const res = await h.api.api.agents({ id: agent.id }).get()
    expect(res.data?.id).toBe(agent.id)
    expect(res.data?.keyPrefix.startsWith('wln_agt_')).toBe(true)
    expect(res.data?.grants).toEqual([])
    expect(Object.keys(res.data ?? {})).not.toContain('apiKey')
  })

  test('DELETE /api/agents/:id removes the agent', async () => {
    const agent = await newAgent()
    const del = await h.api.api.agents({ id: agent.id }).delete()
    expect(del.data).toEqual({ deleted: true })
    const after = await h.api.api.agents({ id: agent.id }).get()
    expect(after.status).toBe(404)
  })

  test('an agent is born with zero grants (a role is provisioned lazily on first approval)', async () => {
    const agent = await newAgent()
    const grants = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))
    expect(grants.length).toBe(0)
  })

  test('approving a scope request is a pure metadata write; the scoped role is provisioned lazily on first query', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read', 'db:write'])

    // Approval writes the grant + scope rows (pure policy) and provisions no Postgres role.
    const grants = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))
    expect(grants.length).toBe(1)
    const g = grants[0]
    expect(g?.resourceType).toBe('project')
    expect(g?.resourceId).toBe(project.id)
    const scopeRows = await h.ctx.db.select().from(agentGrantScopes).where(eq(agentGrantScopes.grantId, g?.id ?? ''))
    expect(scopeRows.map((r) => r.scope).toSorted()).toEqual(['db:read', 'db:write'])
    expect(scopeRows.every((r) => r.expiresAt === null)).toBe(true)
    // No shared scope role exists yet on the main branch — it's provisioned on first use.
    const [main] = await h.ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.projectId, project.id), eq(branches.isDefault, true)))
    const before = await h.ctx.db.select().from(branchDbRoles).where(eq(branchDbRoles.branchId, main?.id ?? ''))
    expect(before.length).toBe(0)

    // The first query provisions the shared scope role for the {read,write} set and caches it.
    const ran = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: bearer(agent.apiKey) })
    expect(ran.status).toBe(200)
    const after = await h.ctx.db.select().from(branchDbRoles).where(eq(branchDbRoles.branchId, main?.id ?? ''))
    expect(after.length).toBe(1)
    expect(after[0]?.scopeKey).toBe(scopeSetKey(['db:read', 'db:write']))
    expect(after[0]?.connectionUri ?? '').toContain('postgres')
    expect(after[0]?.dbRole ?? '').toContain('_s')
  }, 20_000)
})

describe('agent branch API', () => {
  test('GET /agent/v1/branches lists the target project branches', async () => {
    const project = await newProject('agent-branches')
    await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })
    const agent = await newAgent('br-agent')
    const res = await h.api.agent.v1.branches.get({ headers: bearer(agent.apiKey) })
    expect(res.status).toBe(200)
    expect((res.data ?? []).map((b) => b.name).toSorted()).toEqual(['feature', 'main'])
    expect(res.data?.find((b) => b.name === 'main')?.isDefault).toBe(true)
  }, 20_000)

  test('scope request with a branch name targets that branch (agent-friendly form)', async () => {
    const project = await newProject('agent-branch-req')
    const br = await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })
    const agent = await newAgent('br-req-agent')
    const res = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:write'], branch: 'feature' },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(200)
    expect(res.data?.resourceType).toBe('branch')
    expect(res.data?.resourceId).toBe(br.data?.id)
  }, 20_000)

  test('a non-UUID projectId on the agent API is a clean 422, not a 500', async () => {
    // The CLI passes `--project <id>` as a UUID; a malformed one is rejected by the body/query
    // schema before resolveAgentProject can hit the Postgres `uuid` cast.
    const agent = await newAgent('bad-proj-agent')
    const q = await h.api.agent.v1.query.post(
      { sql: 'select 1', projectId: 'not-a-uuid' },
      { headers: bearer(agent.apiKey) },
    )
    expect(q.status).toBe(422)
    const br = await h.api.agent.v1.branches.get({ headers: bearer(agent.apiKey), query: { projectId: 'nope' } })
    expect(br.status).toBe(422)
  }, 20_000)
})

describe('agent branch create', () => {
  test('POST /agent/v1/branches without branch:create is 403 insufficient_scope', async () => {
    const project = await newProject('agent-create-denied')
    const agent = await newAgent('create-denied')
    // db scopes don't authorize branch creation — only branch:create does.
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    const res = await h.api.agent.v1.branches.post({ name: 'feature' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('insufficient_scope')
    expect(body?.missingScopes).toEqual(['branch:create'])
    // Guidance names the CLI verb the agent has, with the precise scope — not the HTTP endpoint.
    expect(body?.howToRequest).toContain('walnut scope request branch:create')
    expect(body?.howToRequest).not.toContain('POST /agent')
    // No branch was provisioned by the rejected call.
    const list = await h.api.agent.v1.branches.get({ headers: bearer(agent.apiKey) })
    expect((list.data ?? []).map((b) => b.name).toSorted()).toEqual(['main'])
  }, 20_000)

  test('a project-level branch:create grant lets an agent fork the default branch', async () => {
    const project = await newProject('agent-create-ok')
    const agent = await newAgent('create-ok')
    await grantResource(agent.apiKey, 'project', project.id, ['branch:create'])
    const res = await h.api.agent.v1.branches.post({ name: 'feature' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(200)
    expect(res.data?.name).toBe('feature')
    expect(res.data?.isDefault).toBe(false)
    expect(res.data?.status).toBe('active')
    const list = await h.api.agent.v1.branches.get({ headers: bearer(agent.apiKey) })
    expect((list.data ?? []).map((b) => b.name).toSorted()).toEqual(['feature', 'main'])
  }, 30_000)

  test('--from forks a named source branch (the copy-on-write source)', async () => {
    const project = await newProject('agent-create-from')
    const agent = await newAgent('create-from')
    const auth = bearer(agent.apiKey)
    await grantResource(agent.apiKey, 'project', project.id, ['db:read', 'db:write', 'db:ddl', 'branch:create'])
    // Build state on a non-default branch (created by the agent), then fork *that*.
    await h.api.agent.v1.branches.post({ name: 'staging' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'CREATE TABLE s (id int)', branch: 'staging' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO s VALUES (1)', branch: 'staging' }, { headers: auth })
    const child = await h.api.agent.v1.branches.post({ name: 'staging-copy', from: 'staging' }, { headers: auth })
    expect(child.status).toBe(200)
    // The fork sees staging's seeded row; the project db grant cascades so the agent can query it.
    const onChild = await h.api.agent.v1.query.post(
      { sql: 'SELECT count(*)::int AS c FROM s', branch: 'staging-copy' },
      { headers: auth },
    )
    expect(onChild.data?.rows).toEqual([{ c: 1 }])
  }, 30_000)

  test('an org-level branch:create grant authorizes forks in any project of the org', async () => {
    const orgId = await personalOrgId()
    const project = await newProject('agent-create-org')
    const agent = await newAgent('create-org')
    await grantResource(agent.apiKey, 'org', orgId, ['branch:create'])
    const res = await h.api.agent.v1.branches.post(
      { name: 'org-feature', projectId: project.id },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(200)
    expect(res.data?.name).toBe('org-feature')
  }, 30_000)

  test('a branch-level branch:create grant authorizes forking that specific source branch', async () => {
    const project = await newProject('agent-create-branchlvl')
    const seed = await h.api.api.projects({ id: project.id }).branches.post({ name: 'seed' })
    const agent = await newAgent('create-branchlvl')
    await grantResource(agent.apiKey, 'branch', seed.data?.id ?? '', ['branch:create'])
    // Forking the granted source branch is allowed...
    const ok = await h.api.agent.v1.branches.post({ name: 'seed-fork', from: 'seed' }, { headers: bearer(agent.apiKey) })
    expect(ok.status).toBe(200)
    // ...but the grant doesn't extend to forking a *different* source (here, main).
    const denied = await h.api.agent.v1.branches.post({ name: 'main-fork' }, { headers: bearer(agent.apiKey) })
    expect(denied.status).toBe(403)
    expect((denied.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['branch:create'])
  }, 30_000)

  test('a branch:create grant on a different project does not authorize a fork in another', async () => {
    const projectA = await newProject('agent-create-a')
    const projectB = await newProject('agent-create-b')
    const agent = await newAgent('create-wrong-proj')
    // The grant is anchored to project A only.
    await grantResource(agent.apiKey, 'project', projectA.id, ['branch:create'])
    const denied = await h.api.agent.v1.branches.post(
      { name: 'feature', projectId: projectB.id },
      { headers: bearer(agent.apiKey) },
    )
    expect(denied.status).toBe(403)
    expect((denied.error?.value as ErrorBody | undefined)?.error).toBe('insufficient_scope')
    // It still works on the project it was granted on.
    const ok = await h.api.agent.v1.branches.post(
      { name: 'feature', projectId: projectA.id },
      { headers: bearer(agent.apiKey) },
    )
    expect(ok.status).toBe(200)
  }, 30_000)

  test('a projectId in another org is a 404 (resolved before the scope check, no existence leak)', async () => {
    // A project owned by a different user/org; our agent must not reach it even to be told 403.
    const stranger = await h.clientFor('33333333-3333-3333-3333-333333333333', { email: 'stranger3@example.com' })
    const foreign = await stranger.api.projects.post({ name: 'foreign' })
    const agent = await newAgent('create-cross-org')
    await grantResource(agent.apiKey, 'org', await personalOrgId(), ['branch:create'])
    const res = await h.api.agent.v1.branches.post(
      { name: 'feature', projectId: foreign.data?.id ?? '' },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(404)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('not_found')
  }, 30_000)

  test('a duplicate branch name on the agent route is a 409', async () => {
    const project = await newProject('agent-create-dup')
    const agent = await newAgent('create-dup')
    await grantResource(agent.apiKey, 'project', project.id, ['branch:create'])
    const first = await h.api.agent.v1.branches.post({ name: 'dev' }, { headers: bearer(agent.apiKey) })
    expect(first.status).toBe(200)
    const again = await h.api.agent.v1.branches.post({ name: 'dev' }, { headers: bearer(agent.apiKey) })
    expect(again.status).toBe(409)
    expect((again.error?.value as ErrorBody | undefined)?.error).toBe('branch_exists')
  }, 30_000)

  test('an invalid branch name passes the route schema but is rejected 400 by the core validator', async () => {
    const project = await newProject('agent-create-badname')
    const agent = await newAgent('create-badname')
    await grantResource(agent.apiKey, 'project', project.id, ['branch:create'])
    // Non-empty and ≤64 chars, so it clears the route schema; the charset check lives in the service.
    const res = await h.api.agent.v1.branches.post({ name: 'has spaces' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(400)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('bad_request')
  }, 20_000)
})

describe('org-scoped agents', () => {
  test('identity reports the agent\'s organization and no project until granted', async () => {
    const agent = await newAgent('org-bot')
    const res = await h.api.agent.v1.identity.get({ headers: bearer(agent.apiKey) })
    expect(typeof res.data?.organization.id).toBe('string')
    expect(res.data?.project).toBeNull()
  })

  test('an agent can be granted access to specific projects and target them', async () => {
    const home = await newProject('home-proj')
    const other = await newProject('other-proj')
    const agent = await newAgent('multi-bot')
    const auth = bearer(agent.apiKey)

    // Explicitly request db:read on the OTHER project, approve it.
    const req = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], resourceType: 'project', resourceId: other.id },
      { headers: auth },
    )
    expect(req.status).toBe(200)
    expect(req.data?.resourceType).toBe('project')
    expect(req.data?.resourceId).toBe(other.id)
    const id = req.data?.id
    if (id === undefined) throw new Error('no request id')
    await h.api.api['scope-requests']({ id }).approve.post()
    // Also grant read on home, so it now reaches two projects.
    await grant(agent.apiKey, home.id, ['db:read'])

    // Two granted projects → an untargeted query is ambiguous and lists the candidates.
    const ambiguous = await h.api.agent.v1.query.post({ sql: 'select 1' }, { headers: auth })
    expect(ambiguous.status).toBe(400)
    const body = ambiguous.error?.value as (ErrorBody & { projects?: { id: string }[] }) | undefined
    expect(body?.error).toBe('ambiguous_project')
    expect(body?.projects?.map((p) => p.id).toSorted()).toEqual([home.id, other.id].toSorted())

    // Targeting a specific project (where it has db:read) succeeds over its own role.
    const ok = await h.api.agent.v1.query.post({ sql: 'select 1 as n', projectId: other.id }, { headers: auth })
    expect(ok.status).toBe(200)
    expect(ok.data?.rows).toEqual([{ n: 1 }])
  }, 30_000)

  test('requesting db scopes at the org level is rejected (no org database)', async () => {
    const agent = await newAgent('org-req-bot')
    const orgId = await personalOrgId()
    const res = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], resourceType: 'org', resourceId: orgId },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
  })

  test('deleting a project clears its grants; the org-scoped agent keeps its other access', async () => {
    const home = await newProject('keep')
    const other = await newProject('drop')
    const agent = await newAgent('survivor')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, home.id, ['db:read'])
    await grant(agent.apiKey, other.id, ['db:read'])

    await h.api.api.projects({ id: other.id }).delete()

    // The grant on the deleted project is gone (no dangling reference): identity resolves to
    // `home`, and an untargeted query is no longer ambiguous — it runs on home.
    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.status).toBe(200)
    expect(identity.data?.project?.id).toBe(home.id)
    const q = await h.api.agent.v1.query.post({ sql: 'select 1 as n' }, { headers: auth })
    expect(q.status).toBe(200)
    expect(q.data?.rows).toEqual([{ n: 1 }])
  }, 30_000)

  test('requesting access on a project in another org is 404 (no existence leak)', async () => {
    const agent = await newAgent('leak-bot')
    const stranger = await h.clientFor('66666666-6666-6666-6666-666666666666', { email: 'stranger6@example.com' })
    const theirs = await stranger.api.projects.post({ name: 'theirs' })
    const theirId = theirs.data?.id
    if (theirId === undefined) throw new Error('stranger project create failed')

    const res = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], resourceType: 'project', resourceId: theirId },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(404)
  })
})

describe('agent key rotation', () => {
  test('rotate-key mints a new working key and invalidates the old one', async () => {
    const orgId = await personalOrgId()
    const created = await h.api.api.organizations({ orgId }).agents.post({ name: 'rotate-bot' })
    const agentId = created.data?.id ?? ''
    const oldKey = created.data?.apiKey ?? ''
    expect(await (await h.api.agent.v1.identity.get({ headers: bearer(oldKey) })).status).toBe(200)

    const rotated = await h.api.api.agents({ id: agentId })['rotate-key'].post()
    expect(rotated.status).toBe(200)
    const newKey = rotated.data?.apiKey ?? ''
    expect(newKey).not.toBe('')
    expect(newKey).not.toBe(oldKey)

    // New key authenticates as the same agent; the old key no longer works.
    const withNew = await h.api.agent.v1.identity.get({ headers: bearer(newKey) })
    expect(withNew.status).toBe(200)
    expect(withNew.data?.id).toBe(agentId)
    expect((await h.api.agent.v1.identity.get({ headers: bearer(oldKey) })).status).toBe(401)
  })

  test('rotate-key on another org’s agent is 404', async () => {
    const orgId = await personalOrgId()
    const created = await h.api.api.organizations({ orgId }).agents.post({ name: 'mine-bot' })
    const agentId = created.data?.id ?? ''
    const stranger = await h.clientFor('66666666-6666-6666-6666-666666666666', { email: 'stranger6@example.com' })
    const res = await stranger.api.agents({ id: agentId })['rotate-key'].post()
    expect(res.status).toBe(404)
  })
})

describe('agent grant revocation', () => {
  /** The agent's grant breakdown from the detail endpoint. */
  async function grantsOf(agentId: string) {
    const res = await h.api.api.agents({ id: agentId }).get()
    if (res.data === null) {
      throw new Error(`getAgent failed: ${JSON.stringify(res.error?.value)}`)
    }
    return res.data.grants
  }

  test('detail endpoint reports each grant with its id, resource and live scopes', async () => {
    const project = await newProject('detail-proj')
    const agent = await newAgent('detail-bot')
    await grant(agent.apiKey, project.id, ['db:read', 'db:write'])

    const grants = await grantsOf(agent.id)
    expect(grants.length).toBe(1)
    const g = grants[0]
    expect(typeof g?.id).toBe('string')
    expect(g?.resourceType).toBe('project')
    expect(g?.resourceId).toBe(project.id)
    expect(g?.resourceName).toBe('detail-proj')
    expect(g?.scopes.map((s) => s.scope).toSorted()).toEqual(['db:read', 'db:write'])
    expect(g?.scopes.every((s) => s.expiresAt === null)).toBe(true)
  }, 20_000)

  test('revoking a single scope drops it from effective access; the rest still works', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read', 'db:write'])
    const grantId = (await grantsOf(agent.id))[0]?.id ?? ''

    const revoked = await h.api.api.agents({ id: agent.id }).grants({ grantId }).scopes({ scope: 'db:write' }).delete()
    expect(revoked.status).toBe(200)
    expect(revoked.data).toEqual({ revoked: true })

    // Detail now shows only db:read on the (still-present) grant.
    const grants = await grantsOf(agent.id)
    expect(grants.length).toBe(1)
    expect(grants[0]?.scopes.map((s) => s.scope)).toEqual(['db:read'])

    // A read still succeeds; a write is now denied for the missing scope.
    const read = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: bearer(agent.apiKey) })
    expect(read.status).toBe(200)
    const write = await h.api.agent.v1.query.post(
      { sql: 'INSERT INTO t (x) VALUES (1)' },
      { headers: bearer(agent.apiKey) },
    )
    expect(write.status).toBe(403)
    expect((write.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['db:write'])
  }, 20_000)

  test('revoking the whole grant removes all access on that resource', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read', 'db:write'])
    const grantId = (await grantsOf(agent.id))[0]?.id ?? ''

    const revoked = await h.api.api.agents({ id: agent.id }).grants({ grantId }).delete()
    expect(revoked.status).toBe(200)
    expect(revoked.data).toEqual({ revoked: true })

    expect(await grantsOf(agent.id)).toEqual([])
    const read = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })
    expect(read.status).toBe(403)
    expect((read.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['db:read'])
  }, 20_000)

  test('revoking the last scope deletes the now-empty grant row', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])
    const grantId = (await grantsOf(agent.id))[0]?.id ?? ''

    await h.api.api.agents({ id: agent.id }).grants({ grantId }).scopes({ scope: 'db:read' }).delete()

    expect(await grantsOf(agent.id)).toEqual([])
    const rows = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))
    expect(rows.length).toBe(0)
  }, 20_000)

  test('revocation is org-scoped and 404s on unknown grant or unheld scope', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])
    const grantId = (await grantsOf(agent.id))[0]?.id ?? ''

    // A user in another org can't revoke this agent's grant — whole grant or a single scope.
    const stranger = await h.clientFor('55555555-5555-5555-5555-555555555555', { email: 'stranger5@example.com' })
    expect((await stranger.api.agents({ id: agent.id }).grants({ grantId }).delete()).status).toBe(404)
    expect(
      (await stranger.api.agents({ id: agent.id }).grants({ grantId }).scopes({ scope: 'db:read' }).delete()).status,
    ).toBe(404)

    // Unknown grant id → 404.
    const unknown = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    expect((await h.api.api.agents({ id: agent.id }).grants({ grantId: unknown }).delete()).status).toBe(404)

    // A scope the grant doesn't hold → 404 (and the held scope is untouched).
    const miss = await h.api.api.agents({ id: agent.id }).grants({ grantId }).scopes({ scope: 'db:delete' }).delete()
    expect(miss.status).toBe(404)
    expect((await grantsOf(agent.id))[0]?.scopes.map((s) => s.scope)).toEqual(['db:read'])
  }, 20_000)
})

