import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { treaty } from '@elysiajs/eden'
import { runSql, SYSTEM_USER_ID } from '@walnut/core'
import { agentGrants, agentGrantScopes, branches, organizationMembers, organizations } from '@walnut/db'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createApp } from '../src/app.ts'
import type { HexclaveServerClient } from '../src/auth/hexclave-server.ts'
import { devAuthRoutes } from '../src/routes/dev-auth.ts'
import { createHarness, type Harness } from './harness.ts'

interface ErrorBody {
  error: string
  message: string
  missingScopes?: string[]
  requiredScopes?: string[]
  grantedScopes?: string[]
}

let h: Harness

beforeAll(async () => {
  h = await createHarness()
}, 30_000)
afterAll(async () => {
  await h.dispose()
}, 30_000)
beforeEach(async () => {
  await h.reset()
}, 15_000)

async function newProject(name = 'proj'): Promise<{ id: string }> {
  const res = await h.api.api.projects.post({ name })
  if (res.data === null) {
    throw new Error(`createProject failed: ${JSON.stringify(res.error?.value)}`)
  }
  return res.data
}

/** Create a grant-less agent in the seeded user's personal org. */
async function newAgent(name = 'agent'): Promise<{ id: string; apiKey: string }> {
  const orgId = await personalOrgId()
  const res = await h.api.api.organizations({ orgId }).agents.post({ name })
  if (res.data === null) {
    throw new Error(`createAgent failed: ${JSON.stringify(res.error?.value)}`)
  }
  return res.data
}

function bearer(apiKey: string): { authorization: string } {
  return { authorization: `Bearer ${apiKey}` }
}

/** Epoch ms for a date field. The in-memory treaty harness hands back Date objects where
 * real HTTP would yield ISO strings (the serializer contract); this compares either form. */
function ms(v: string | Date | null | undefined): number {
  return v == null ? Number.NaN : new Date(v).getTime()
}

describe('health', () => {
  test('GET /health', async () => {
    const { data, status } = await h.api.health.get()
    expect(status).toBe(200)
    expect(data).toEqual({ status: 'ok' })
  })
})

describe('projects', () => {
  test('POST /api/projects provisions an active database', async () => {
    const res = await h.api.api.projects.post({ name: 'my-db' })
    expect(res.status).toBe(200)
    expect(res.data?.name).toBe('my-db')
    expect(res.data?.status).toBe('active')
    expect(res.data?.provider).toBe('local')
    expect(typeof res.data?.connectionUri).toBe('string')
  })

  test('POST /api/projects rejects an empty name', async () => {
    const res = await h.api.api.projects.post({ name: '' })
    expect(res.status).toBe(422)
  })

  test('GET /api/projects lists created projects', async () => {
    await newProject('a')
    await newProject('b')
    const res = await h.api.api.projects.get()
    expect(res.data?.length).toBe(2)
  })

  test('GET /api/projects/:id returns detail; unknown id is 404', async () => {
    const project = await newProject('detail')
    const ok = await h.api.api.projects({ id: project.id }).get()
    expect(ok.data?.id).toBe(project.id)

    const missing = await h.api.api.projects({ id: '00000000-0000-0000-0000-000000000123' }).get()
    expect(missing.status).toBe(404)
  })

  test('DELETE /api/projects/:id removes the project', async () => {
    const project = await newProject('to-delete')
    const del = await h.api.api.projects({ id: project.id }).delete()
    expect(del.data).toEqual({ deleted: true })
    const after = await h.api.api.projects({ id: project.id }).get()
    expect(after.status).toBe(404)
  })
})

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

  test('GET /api/agents/:id returns the agent without its key', async () => {
    const agent = await newAgent()
    const res = await h.api.api.agents({ id: agent.id }).get()
    expect(res.data?.id).toBe(agent.id)
    expect(res.data?.keyPrefix.startsWith('wln_agt_')).toBe(true)
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

  test('approving a scope request is a pure metadata write; the role is provisioned lazily on first query', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read', 'db:write'])

    // Approval writes the grant + scope rows but touches no Postgres role yet.
    const grants = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))
    expect(grants.length).toBe(1)
    const g = grants[0]
    expect(g?.resourceType).toBe('project')
    expect(g?.resourceId).toBe(project.id)
    expect(g?.dbRole).toBeNull()
    expect(g?.connectionUri).toBeNull()
    expect(g?.syncedScopes).toBeNull()
    const scopeRows = await h.ctx.db.select().from(agentGrantScopes).where(eq(agentGrantScopes.grantId, g?.id ?? ''))
    expect(scopeRows.map((r) => r.scope).toSorted()).toEqual(['db:read', 'db:write'])
    expect(scopeRows.every((r) => r.expiresAt === null)).toBe(true)

    // The first query provisions the role lazily and records the synced snapshot.
    const ran = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: bearer(agent.apiKey) })
    expect(ran.status).toBe(200)
    const [after] = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.id, g?.id ?? ''))
    expect(typeof after?.dbRole).toBe('string')
    expect(after?.connectionUri ?? '').toContain('postgres')
    expect(after?.syncedScopes).toEqual(['db:read', 'db:write'])
  }, 20_000)
})

describe('agent API authentication', () => {
  test('missing key is 401', async () => {
    const res = await h.api.agent.v1.identity.get()
    expect(res.status).toBe(401)
  })

  test('invalid key is 401', async () => {
    const res = await h.api.agent.v1.identity.get({ headers: bearer('wln_agt_nope') })
    expect(res.status).toBe(401)
  })

  test('GET /agent/v1/identity has no project until granted, then reports it', async () => {
    const project = await newProject('identity')
    const agent = await newAgent('ident-bot')
    const before = await h.api.agent.v1.identity.get({ headers: bearer(agent.apiKey) })
    expect(before.data?.id).toBe(agent.id)
    expect(before.data?.scopes).toEqual([])
    expect(before.data?.project).toBeNull()

    await grant(agent.apiKey, project.id, ['db:read'])
    const after = await h.api.agent.v1.identity.get({ headers: bearer(agent.apiKey) })
    expect(after.data?.project?.id).toBe(project.id)
    expect(after.data?.scopes).toEqual(['db:read'])
  }, 20_000)
})

describe('agent query scope enforcement', () => {
  test('reading without db:read is denied with a clear message', async () => {
    await newProject()
    const agent = await newAgent()
    const res = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('insufficient_scope')
    expect(body?.missingScopes).toEqual(['db:read'])
  })

  test('an empty statement is rejected', async () => {
    await newProject()
    const agent = await newAgent()
    const res = await h.api.agent.v1.query.post({ sql: '   ' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(400)
  })

  test('a read-only agent cannot smuggle DDL via a multi-statement batch', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])
    const res = await h.api.agent.v1.query.post(
      { sql: 'SELECT 1; DROP TABLE IF EXISTS secrets' },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.missingScopes).toEqual(['db:ddl'])
  })

  test('a read-only agent cannot delete via EXPLAIN ANALYZE', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    // Seed a table with a row using the privileged grant.
    await h.api.agent.v1.query.post({ sql: 'CREATE TABLE t (id int)' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO t VALUES (1)' }, { headers: auth })

    // A second, read-only agent must not be able to run EXPLAIN ANALYZE DELETE.
    const reader = await newAgent('reader')
    await grant(reader.apiKey, project.id, ['db:read'])
    const res = await h.api.agent.v1.query.post(
      { sql: 'EXPLAIN ANALYZE DELETE FROM t' },
      { headers: bearer(reader.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.missingScopes).toEqual(['db:delete'])

    // Confirm the row is still there.
    const check = await h.api.agent.v1.query.post({ sql: 'SELECT count(*) AS c FROM t' }, { headers: auth })
    expect(check.data?.rows).toEqual([{ c: '1' }])
  })

  test('granting scopes enables the full read/write/ddl lifecycle', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])

    const create = await h.api.agent.v1.query.post(
      { sql: 'CREATE TABLE notes (id serial primary key, body text)' },
      { headers: auth },
    )
    expect(create.status).toBe(200)

    const insert = await h.api.agent.v1.query.post(
      { sql: "INSERT INTO notes (body) VALUES ('hello')" },
      { headers: auth },
    )
    expect(insert.status).toBe(200)
    expect(insert.data?.rowCount).toBe(1)

    const select = await h.api.agent.v1.query.post({ sql: 'SELECT body FROM notes' }, { headers: auth })
    expect(select.data?.rows).toEqual([{ body: 'hello' }])
  })

  test('writing without db:write is denied even with db:read', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])
    const res = await h.api.agent.v1.query.post(
      { sql: "INSERT INTO whatever (x) VALUES (1)" },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.missingScopes).toEqual(['db:write'])
  })

  test('a SQL error surfaces as a 400 query_error', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])
    const res = await h.api.agent.v1.query.post(
      { sql: 'SELECT * FROM table_that_does_not_exist' },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('query_error')
  })
})

describe('database-level role enforcement', () => {
  // `SELECT ... INTO` actually creates a table. A leading-keyword scan would pass it as
  // db:read; the real-grammar classifier sees the CTAS and requires db:ddl, so a
  // read-only agent is denied at the classifier (and, were it to slip through, the
  // restricted role lacks CREATE — see the large-object test for that engine backstop).
  test('SELECT ... INTO is classified as DDL and denied for a read-only agent', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])

    const res = await h.api.agent.v1.query.post(
      { sql: 'SELECT 1 AS n INTO leaked_table' },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('insufficient_scope')
    expect(body?.missingScopes).toEqual(['db:ddl'])

    // And the table was never created.
    const check = await h.api.agent.v1.query.post(
      { sql: "SELECT to_regclass('public.leaked_table') AS t" },
      { headers: bearer(agent.apiKey) },
    )
    expect(check.data?.rows).toEqual([{ t: null }])
  })

  test('a read-only agent cannot create large objects (PUBLIC lockdown)', async () => {
    // `SELECT lo_create(...)` classifies as db:read but writes a large object — the
    // role lockdown revokes the LO write functions from PUBLIC, so the engine refuses it.
    const project = await newProject()
    const agent = await newAgent()
    await grant(agent.apiKey, project.id, ['db:read'])
    const res = await h.api.agent.v1.query.post(
      { sql: 'SELECT lo_create(0)' },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('query_error')
    expect(body?.message.toLowerCase()).toContain('permission denied')
  })

  test('a read-only agent can read a table created by another agent (group grants flow)', async () => {
    const project = await newProject()
    const author = await newAgent('author')
    await grant(author.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    const authorAuth = bearer(author.apiKey)
    await h.api.agent.v1.query.post(
      { sql: 'CREATE TABLE shared (id int)' },
      { headers: authorAuth },
    )
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO shared VALUES (42)' }, { headers: authorAuth })

    const reader = await newAgent('reader')
    await grant(reader.apiKey, project.id, ['db:read'])
    const read = await h.api.agent.v1.query.post(
      { sql: 'SELECT id FROM shared' },
      { headers: bearer(reader.apiKey) },
    )
    expect(read.status).toBe(200)
    expect(read.data?.rows).toEqual([{ id: 42 }])
  })
})

describe('scope expiry', () => {
  /** Request scopes with a TTL and approve them; returns the grant row id. */
  async function grantWithTtl(
    apiKey: string,
    projectId: string,
    scopes: ('db:read' | 'db:write' | 'db:delete' | 'db:ddl')[],
    expiresInSeconds: number,
  ): Promise<void> {
    const reqRes = await h.api.agent.v1['scope-requests'].post(
      { scopes, expiresInSeconds, resourceType: 'project', resourceId: projectId },
      { headers: bearer(apiKey) },
    )
    const id = reqRes.data?.id
    if (id === undefined) throw new Error(`ttl scope request failed: ${JSON.stringify(reqRes.error?.value)}`)
    expect(reqRes.data?.expiresInSeconds).toBe(expiresInSeconds)
    await h.api.api['scope-requests']({ id }).approve.post()
  }

  /** Force a scope's deadline into the past so the next reconcile treats it as expired. */
  async function expireScope(
    agentId: string,
    projectId: string,
    scope: 'db:read' | 'db:write' | 'db:delete' | 'db:ddl',
  ): Promise<void> {
    const [g] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.resourceId, projectId)))
    await h.ctx.db
      .update(agentGrantScopes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(agentGrantScopes.grantId, g?.id ?? ''), eq(agentGrantScopes.scope, scope)))
  }

  test('a time-boxed scope works while valid and carries its expiry in the roster', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grantWithTtl(agent.apiKey, project.id, ['db:read'], 3600)

    // The scope is usable while in force.
    const ran = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: bearer(agent.apiKey) })
    expect(ran.status).toBe(200)

    // The scope row carries a concrete deadline ~1h out (the approval-time clock).
    const [g] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.agentId, agent.id), eq(agentGrants.resourceId, project.id)))
    const [scopeRow] = await h.ctx.db
      .select()
      .from(agentGrantScopes)
      .where(and(eq(agentGrantScopes.grantId, g?.id ?? ''), eq(agentGrantScopes.scope, 'db:read')))
    const remainingMs = (scopeRow?.expiresAt?.getTime() ?? 0) - Date.now()
    expect(remainingMs).toBeGreaterThan(3000_000)
    expect(remainingMs).toBeLessThanOrEqual(3600_000)

    // The org roster surfaces the per-scope expiry (non-null deadline) on the grant.
    const orgId = await personalOrgId()
    const roster = await h.api.api.organizations({ orgId }).agents.get()
    const row = roster.data?.find((a) => a.id === agent.id)
    const grantView = row?.grants.find((gr) => gr.resourceId === project.id)
    const readScope = grantView?.scopes.find((s) => s.scope === 'db:read')
    expect(readScope).toBeDefined()
    expect(readScope?.expiresAt).not.toBeNull()
  }, 20_000)

  test('an expired scope is denied at the classifier and revoked from the role on the next valid query', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    // Permanent read + a time-boxed write; a first query provisions the scoped role.
    await grant(agent.apiKey, project.id, ['db:read'])
    await grantWithTtl(agent.apiKey, project.id, ['db:write'], 3600)
    const seed = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: auth })
    expect(seed.status).toBe(200)

    // Time passes: the write scope lapses.
    await expireScope(agent.id, project.id, 'db:write')

    // The classifier now refuses a write (effective scopes no longer include db:write).
    // The table need not exist — the missing-scope check runs before any execution.
    const blocked = await h.api.agent.v1.query.post(
      { sql: 'INSERT INTO some_table VALUES (1)' },
      { headers: auth },
    )
    expect(blocked.status).toBe(403)
    expect((blocked.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['db:write'])

    // A still-valid read reconciles the role: the expired write membership is revoked,
    // leaving the synced snapshot at just db:read.
    const read = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: auth })
    expect(read.status).toBe(200)
    const [g] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.agentId, agent.id), eq(agentGrants.resourceId, project.id)))
    expect(g?.syncedScopes).toEqual(['db:read'])

    // The agent's identity also reflects only the live scope.
    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.data?.scopes).toEqual(['db:read'])
  }, 25_000)

  test('when every scope lapses, even a denied query revokes the stale role memberships', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    // A single time-boxed scope, provisioned onto the role by an authorised query.
    await grantWithTtl(agent.apiKey, project.id, ['db:read'], 3600)
    const seed = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: auth })
    expect(seed.status).toBe(200)
    const [before] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.agentId, agent.id), eq(agentGrants.resourceId, project.id)))
    expect(before?.syncedScopes).toEqual(['db:read'])

    // The scope lapses, leaving the grant with zero effective scopes.
    await expireScope(agent.id, project.id, 'db:read')

    // The next query is denied (nothing is in force) — but the engine cache must not be left
    // stale: the reconcile on the denied path revokes the lapsed db:read membership.
    const blocked = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: auth })
    expect(blocked.status).toBe(403)
    const [after] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.agentId, agent.id), eq(agentGrants.resourceId, project.id)))
    expect(after?.syncedScopes).toEqual([])
  }, 20_000)

  test('re-requesting a scope extends its expiry (the later deadline wins)', async () => {
    const project = await newProject()
    const agent = await newAgent()
    await grantWithTtl(agent.apiKey, project.id, ['db:read'], 60)
    await grantWithTtl(agent.apiKey, project.id, ['db:read'], 7200)
    const [g] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.agentId, agent.id), eq(agentGrants.resourceId, project.id)))
    const [scopeRow] = await h.ctx.db
      .select()
      .from(agentGrantScopes)
      .where(and(eq(agentGrantScopes.grantId, g?.id ?? ''), eq(agentGrantScopes.scope, 'db:read')))
    // The 2h deadline beats the 1m one — never shortened.
    const remainingMs = (scopeRow?.expiresAt?.getTime() ?? 0) - Date.now()
    expect(remainingMs).toBeGreaterThan(3600_000)
  })

  test('a non-positive or oversized TTL is rejected', async () => {
    await newProject()
    const agent = await newAgent()
    const zero = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], expiresInSeconds: 0 },
      { headers: bearer(agent.apiKey) },
    )
    expect(zero.status).not.toBe(200)
    const huge = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], expiresInSeconds: 999_999_999 },
      { headers: bearer(agent.apiKey) },
    )
    expect(huge.status).toBe(400)
  })
})

describe('scope requests', () => {
  test('an agent requests a scope; the dashboard sees it pending and approves it', async () => {
    await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)

    const reqRes = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read', 'db:write'], reason: 'need to seed data' },
      { headers: auth },
    )
    expect(reqRes.status).toBe(200)
    const request = reqRes.data
    if (request === null) throw new Error('no request')
    expect(request.status).toBe('pending')
    expect(request.scopes).toEqual(['db:read', 'db:write'])

    const pending = await h.api.api['scope-requests'].get({ query: { status: 'pending' } })
    expect(pending.data?.length).toBe(1)

    const approved = await h.api.api['scope-requests']({ id: request.id }).approve.post()
    expect(approved.data?.status).toBe('approved')

    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.data?.scopes).toEqual(['db:read', 'db:write'])
  })

  test('approving an already-resolved request is a 409', async () => {
    await newProject()
    const agent = await newAgent()
    const reqRes = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'] },
      { headers: bearer(agent.apiKey) },
    )
    const id = reqRes.data?.id
    if (id === undefined) throw new Error('no request id')
    await h.api.api['scope-requests']({ id }).approve.post()
    const again = await h.api.api['scope-requests']({ id }).approve.post()
    expect(again.status).toBe(409)
  })

  test('denying a request leaves the agent without the scope', async () => {
    await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    const reqRes = await h.api.agent.v1['scope-requests'].post({ scopes: ['db:ddl'] }, { headers: auth })
    const id = reqRes.data?.id
    if (id === undefined) throw new Error('no request id')

    const denied = await h.api.api['scope-requests']({ id }).deny.post()
    expect(denied.data?.status).toBe('denied')

    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.data?.scopes).toEqual([])
  })

  test('requesting an unknown scope is a 400', async () => {
    await newProject()
    const agent = await newAgent()
    const res = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:teleport'] },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
  })

  test('an agent can list its own scope requests', async () => {
    await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: auth })
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:write'] }, { headers: auth })
    const list = await h.api.agent.v1['scope-requests'].get({ headers: auth })
    expect(list.data?.length).toBe(2)
  })
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

describe('auth and org isolation', () => {
  const USER_A = '11111111-1111-1111-1111-111111111111'
  const USER_B = '22222222-2222-2222-2222-222222222222'

  test('a request with no bearer token is 401', async () => {
    // `Bearer ` (no token) overrides the harness's default auth header.
    const res = await h.api.api.projects.get({ headers: { authorization: 'Bearer ' } })
    expect(res.status).toBe(401)
  })

  test('a request with a garbage token is 401', async () => {
    const res = await h.api.api.projects.get({ headers: { authorization: 'Bearer not-a-jwt' } })
    expect(res.status).toBe(401)
  })

  test("a user cannot see or fetch another user's project", async () => {
    const alice = await h.clientFor(USER_A, { email: 'alice@example.com' })
    const bob = await h.clientFor(USER_B, { email: 'bob@example.com' })

    const created = await alice.api.projects.post({ name: 'alice-db' })
    const projectId = created.data?.id
    if (projectId === undefined) throw new Error('alice failed to create project')

    // Bob's list is empty and he can't fetch Alice's project by id.
    const bobList = await bob.api.projects.get()
    expect(bobList.data).toEqual([])
    const bobFetch = await bob.api.projects({ id: projectId }).get()
    expect(bobFetch.status).toBe(404)

    // Alice still sees exactly her own project.
    const aliceList = await alice.api.projects.get()
    expect(aliceList.data?.length).toBe(1)
    expect(aliceList.data?.[0]?.id).toBe(projectId)
  })

  test('first login provisions a personal org with an owner membership', async () => {
    const carol = await h.clientFor(USER_A, { email: 'carol@example.com' })
    // Any authenticated call triggers JIT provisioning.
    await carol.api.projects.get()

    const members = await h.ctx.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_A))
    expect(members.length).toBe(1)
    expect(members[0]?.role).toBe('owner')

    const [org] = await h.ctx.db
      .select()
      .from(organizations)
      .where(eq(organizations.personalUserId, USER_A))
    expect(org?.isPersonal).toBe(true)
  })
})

describe('cross-org isolation', () => {
  const ALICE = '33333333-3333-3333-3333-333333333333'
  const BOB = '44444444-4444-4444-4444-444444444444'

  /** Alice owns a provisioned project with one (grant-less) agent; Bob is unrelated. */
  async function aliceProjectWithAgent() {
    const alice = await h.clientFor(ALICE, { email: 'alice@corp.test' })
    const bob = await h.clientFor(BOB, { email: 'bob@corp.test' })
    const orgs = await alice.api.organizations.get()
    const orgId = orgs.data?.find((o) => o.isPersonal)?.id
    if (orgId === undefined) throw new Error('alice has no personal org')
    const proj = await alice.api.projects.post({ name: 'alice-proj' })
    const projectId = proj.data?.id
    if (projectId === undefined) throw new Error(`project create failed: ${JSON.stringify(proj.error?.value)}`)
    const agentRes = await alice.api.organizations({ orgId }).agents.post({ name: 'a-bot' })
    const agent = agentRes.data
    if (agent === null) throw new Error(`agent create failed: ${JSON.stringify(agentRes.error?.value)}`)
    return { alice, bob, orgId, projectId, agentId: agent.id, agentKey: agent.apiKey }
  }

  test("a user cannot read, delete, or create another user's agents", async () => {
    const { bob, orgId, agentId } = await aliceProjectWithAgent()
    expect((await bob.api.agents({ id: agentId }).get()).status).toBe(404)
    expect((await bob.api.agents({ id: agentId }).delete()).status).toBe(404)
    // Bob isn't a member of Alice's org, so he can't create an agent in it either.
    expect((await bob.api.organizations({ orgId }).agents.post({ name: 'sneaky' })).status).toBe(404)
  })

  test("a user cannot see or resolve another user's scope request", async () => {
    const { alice, bob, agentKey } = await aliceProjectWithAgent()
    const reqRes = await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agentKey) })
    const requestId = reqRes.data?.id
    if (requestId === undefined) throw new Error('scope request failed')

    // Alice (owner) sees it; Bob sees nothing.
    expect((await alice.api['scope-requests'].get({ query: {} })).data?.length).toBe(1)
    expect((await bob.api['scope-requests'].get({ query: {} })).data).toEqual([])

    // Bob cannot approve or deny it...
    expect((await bob.api['scope-requests']({ id: requestId }).approve.post()).status).toBe(404)
    expect((await bob.api['scope-requests']({ id: requestId }).deny.post()).status).toBe(404)
    // ...so it is still pending for Alice.
    expect((await alice.api['scope-requests'].get({ query: { status: 'pending' } })).data?.length).toBe(1)
  })

  test("a user cannot delete another user's project", async () => {
    const { alice, bob, projectId } = await aliceProjectWithAgent()
    expect((await bob.api.projects({ id: projectId }).delete()).status).toBe(404)
    // Bob's failed delete left Alice's project intact.
    expect((await alice.api.projects({ id: projectId }).get()).status).toBe(200)
  })

  test('creating a project provisions a default main branch', async () => {
    const alice = await h.clientFor(ALICE, { email: 'alice@corp.test' })
    const proj = await alice.api.projects.post({ name: 'branchy' })
    const projectId = proj.data?.id
    if (projectId === undefined) throw new Error('project create failed')

    const rows = await h.ctx.db.select().from(branches).where(eq(branches.projectId, projectId))
    expect(rows.length).toBe(1)
    expect(rows[0]?.name).toBe('main')
    expect(rows[0]?.isDefault).toBe(true)
  })
})

describe('dev login bypass', () => {
  /** A fake Hexclave server: mints tokens with the harness keypair so they verify
   * against the real middleware, and is get-or-create idempotent by email. */
  function makeFakeHexclave(): HexclaveServerClient {
    const byEmail = new Map<string, { id: string; email: string }>()
    const emailById = new Map<string, string>()
    return {
      async getOrCreateUser(email) {
        const key = email.trim().toLowerCase()
        let user = byEmail.get(key)
        if (user === undefined) {
          user = { id: crypto.randomUUID(), email: key }
          byEmail.set(key, user)
          emailById.set(user.id, key)
        }
        return user
      },
      async createSession(userId) {
        const email = emailById.get(userId)
        const accessToken = await h.mintToken(userId, email !== undefined ? { email } : {})
        return { accessToken, refreshToken: `refresh_${userId}` }
      },
    }
  }

  function devClient() {
    return treaty(new Elysia().use(devAuthRoutes(makeFakeHexclave())))
  }

  test('returns tokens that authenticate against the dashboard', async () => {
    const dev = devClient()
    const res = await dev.dev.auth.login.post({ email: 'Dev@Example.com' })
    expect(res.status).toBe(200)
    expect(typeof res.data?.accessToken).toBe('string')
    expect(typeof res.data?.refreshToken).toBe('string')

    const auth = bearer(res.data?.accessToken ?? '')
    const created = await h.api.api.projects.post({ name: 'dev-proj' }, { headers: auth })
    expect(created.status).toBe(200)
    const list = await h.api.api.projects.get({ headers: auth })
    expect(list.data?.length).toBe(1)
  })

  test('is idempotent for the same email (same user and org)', async () => {
    const dev = devClient()
    const first = await dev.dev.auth.login.post({ email: 'repeat@example.com' })
    await h.api.api.projects.post({ name: 'p1' }, { headers: bearer(first.data?.accessToken ?? '') })

    // A second login with the same email resolves to the same user, so it sees p1.
    const second = await dev.dev.auth.login.post({ email: 'repeat@example.com' })
    const list = await h.api.api.projects.get({ headers: bearer(second.data?.accessToken ?? '') })
    expect(list.data?.length).toBe(1)
    expect(list.data?.[0]?.name).toBe('p1')
  })

  test('rejects a malformed email with 422', async () => {
    const dev = devClient()
    const res = await dev.dev.auth.login.post({ email: 'not-an-email' })
    expect(res.status).toBe(422)
  })

  test('is not mounted unless a dev-login client is supplied', async () => {
    // The default app (no devLogin option) has no /dev/auth/login route.
    const plain = createApp(h.ctx)
    const res = await plain.handle(
      new Request('http://localhost/dev/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@example.com' }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

describe('dashboard data viewer (POST /api/projects/:id/sql)', () => {
  test('runs a parameterized read-only query', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT $1::int AS n', params: [42] })
    expect(res.status).toBe(200)
    expect(res.data?.rows).toEqual([{ n: 42 }])
    expect(res.data?.fields).toEqual(['n'])
  })

  test('reads multiple rows from a values list (no table needed)', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({
      sql: "SELECT * FROM (VALUES (1, 'a'), (2, 'b')) AS v(id, label) ORDER BY id LIMIT $1",
      params: [10],
    })
    expect(res.status).toBe(200)
    expect(res.data?.rows).toEqual([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    expect(res.data?.fields).toEqual(['id', 'label'])
  })

  test('rejects a write with 403 read_only', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'INSERT INTO t (x) VALUES (1)' })
    expect(res.status).toBe(403)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('read_only')
  })

  test('rejects DDL with 403 read_only', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'CREATE TABLE t (id int)' })
    expect(res.status).toBe(403)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('read_only')
  })

  test('a read-query SQL error surfaces as 400 query_error', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT * FROM no_such_table' })
    expect(res.status).toBe(400)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('query_error')
  })

  test('rejects an empty statement', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: '   ' })
    expect(res.status).toBe(400)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('empty_query')
  })

  test("another user cannot query someone else's project (404)", async () => {
    const project = await newProject()
    const other = await h.clientFor('00000000-0000-0000-0000-0000000000ab', { email: 'other@walnut.cloud' })
    const res = await other.api.projects({ id: project.id }).sql.post({ sql: 'SELECT 1 AS n' })
    expect(res.status).toBe(404)
  })

  test('rejects a multi-statement batch that smuggles a write', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT 1; DROP TABLE foo' })
    expect(res.status).toBe(403)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('read_only')
  })

  test('rejects a delete with 403 read_only', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'DELETE FROM whatever' })
    expect(res.status).toBe(403)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('read_only')
  })

  test('the read-only session is the engine backstop: a write is refused even without the classifier', async () => {
    // The classifier 403s known writes before execution, so to prove the *engine* layer we call
    // runSql directly (as the route does) with readOnly. A write the classifier would otherwise
    // have to catch — here a CREATE — is refused by Postgres itself. This is what guards a
    // classifier blind spot (e.g. a write-performing function in read position).
    const project = await newProject()
    const detail = await h.api.api.projects({ id: project.id }).get()
    const uri = detail.data?.connectionUri
    if (typeof uri !== 'string') {
      throw new Error('project has no connection uri')
    }
    const read = await runSql(uri, 'SELECT 1 AS n', [], { readOnly: true })
    expect(read.rows).toEqual([{ n: 1 }])
    // A write is rejected by the read-only transaction (temp table → no persistence/teardown).
    await expect(runSql(uri, 'CREATE TEMP TABLE _ro_probe (i int)', [], { readOnly: true })).rejects.toThrow(
      'read-only',
    )
    // Sanity: without readOnly the same statement is allowed.
    const ok = await runSql(uri, 'CREATE TEMP TABLE _rw_probe (i int)', [])
    expect(ok.command).toBe('CREATE TABLE')
  })
})

/** Helper: have an agent request scopes on a project and immediately approve them. */
async function grant(
  apiKey: string,
  projectId: string,
  scopes: ('db:read' | 'db:write' | 'db:delete' | 'db:ddl')[],
): Promise<void> {
  const reqRes = await h.api.agent.v1['scope-requests'].post(
    { scopes, resourceType: 'project', resourceId: projectId },
    { headers: bearer(apiKey) },
  )
  const id = reqRes.data?.id
  if (id === undefined) {
    throw new Error(`scope request failed: ${JSON.stringify(reqRes.error?.value)}`)
  }
  await h.api.api['scope-requests']({ id }).approve.post()
}

/** The caller's personal org id (every user gets one on first auth). */
async function personalOrgId(): Promise<string> {
  const res = await h.api.api.organizations.get()
  const org = res.data?.find((o) => o.isPersonal)
  if (org === undefined) {
    throw new Error(`no personal org: ${JSON.stringify(res.error?.value ?? res.data)}`)
  }
  return org.id
}

describe('organizations', () => {
  test('GET /api/organizations returns the caller as owner of their personal org', async () => {
    const res = await h.api.api.organizations.get()
    expect(res.status).toBe(200)
    const personal = res.data?.find((o) => o.isPersonal)
    expect(personal).toBeDefined()
    expect(personal?.role).toBe('owner')
  })

  test('GET /api/organizations/:orgId/projects lists projects with at-a-glance counts', async () => {
    const project = await newProject('counts')
    const a1 = await newAgent('a1')
    const a2 = await newAgent('a2')
    // agentCount = agents with a grant on the project, so grant both their access.
    await grant(a1.apiKey, project.id, ['db:read'])
    await grant(a2.apiKey, project.id, ['db:read'])
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).projects.get()
    expect(res.status).toBe(200)
    const row = res.data?.find((p) => p.id === project.id)
    expect(row?.agentCount).toBe(2)
    expect(row?.pendingRequestCount).toBe(0)
    expect(row?.defaultBranch).toBe('main')
  }, 20_000)

  test('pendingRequestCount counts only open scope requests', async () => {
    const project = await newProject('pending')
    const agent = await newAgent('bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).projects.get()
    expect(res.data?.find((p) => p.id === project.id)?.pendingRequestCount).toBe(1)
  })

  test('GET /api/organizations/:orgId/agents is the org-wide roster with per-project grants', async () => {
    const project = await newProject('roster')
    const agent = await newAgent('roster-bot')
    await grant(agent.apiKey, project.id, ['db:read'])
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).agents.get()
    expect(res.status).toBe(200)
    const bot = res.data?.find((a) => a.name === 'roster-bot')
    expect(bot?.grants.some((g) => g.resourceType === 'project' && g.projectName === 'roster')).toBe(true)
  }, 20_000)

  test('a non-member cannot read another org\'s projects or agents (404, no existence leak)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('11111111-1111-1111-1111-111111111111', { email: 'stranger@example.com' })
    expect((await stranger.api.organizations({ orgId }).projects.get()).status).toBe(404)
    expect((await stranger.api.organizations({ orgId }).agents.get()).status).toBe(404)
  })

  test('POST /api/organizations/:orgId/projects creates the project in that org', async () => {
    const orgId = await personalOrgId()
    const created = await h.api.api.organizations({ orgId }).projects.post({ name: 'in-org' })
    expect(created.status).toBe(200)
    expect(created.data?.name).toBe('in-org')
    const list = await h.api.api.organizations({ orgId }).projects.get()
    expect(list.data?.some((p) => p.id === created.data?.id)).toBe(true)
  })

  test('a non-member cannot create a project in an org (404)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('33333333-3333-3333-3333-333333333333', { email: 'stranger3@example.com' })
    const res = await stranger.api.organizations({ orgId }).projects.post({ name: 'sneaky' })
    expect(res.status).toBe(404)
  })

  test('GET /api/organizations/:orgId/requests lists the org\'s scope requests', async () => {
    await newProject('reqs')
    const agent = await newAgent('r-bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:write'] }, { headers: bearer(agent.apiKey) })
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).requests.get({ query: { status: 'pending' } })
    expect(res.status).toBe(200)
    expect(res.data?.some((r) => r.agentId === agent.id)).toBe(true)
  })

  test('a non-member cannot read an org\'s requests (404)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('44444444-4444-4444-4444-444444444444', { email: 'stranger4@example.com' })
    const res = await stranger.api.organizations({ orgId }).requests.get()
    expect(res.status).toBe(404)
  })

  test("an org's request list excludes other orgs' requests (tenant isolation)", async () => {
    await newProject('iso')
    const agent = await newAgent('iso-bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    const orgA = await personalOrgId()

    // A second org the same user also belongs to, with no projects/requests of its own.
    const [orgB] = await h.ctx.db.insert(organizations).values({ name: 'Org B' }).returning({ id: organizations.id })
    if (orgB === undefined) {
      throw new Error('failed to insert second org')
    }
    await h.ctx.db.insert(organizationMembers).values({ organizationId: orgB.id, userId: SYSTEM_USER_ID, role: 'member' })

    const inA = await h.api.api.organizations({ orgId: orgA }).requests.get({ query: { status: 'pending' } })
    expect(inA.data?.some((r) => r.agentId === agent.id)).toBe(true)
    const inB = await h.api.api.organizations({ orgId: orgB.id }).requests.get({ query: { status: 'pending' } })
    expect(inB.data).toEqual([])
  })
})

describe('branches', () => {
  test('GET /api/projects/:id/branches returns the default main branch', async () => {
    const project = await newProject('branchy')
    const res = await h.api.api.projects({ id: project.id }).branches.get()
    expect(res.status).toBe(200)
    expect(res.data?.length).toBe(1)
    expect(res.data?.[0]?.name).toBe('main')
    expect(res.data?.[0]?.isDefault).toBe(true)
  })

  test('branches of an inaccessible project are 404', async () => {
    const res = await h.api.api.projects({ id: '00000000-0000-0000-0000-0000000000aa' }).branches.get()
    expect(res.status).toBe(404)
  })

  test("branches of another member's project are 404 (forbidden, not just missing)", async () => {
    const project = await newProject('private-branchy')
    const stranger = await h.clientFor('22222222-2222-2222-2222-222222222222', { email: 'stranger2@example.com' })
    const res = await stranger.api.projects({ id: project.id }).branches.get()
    expect(res.status).toBe(404)
  })
})

describe('activity', () => {
  test('agent queries (allowed and denied) are recorded in project activity', async () => {
    const project = await newProject('act')
    const agent = await newAgent('act-bot')

    // A denied attempt first (no scopes yet; SELECT needs db:read), then grant + run.
    const denied = await h.api.agent.v1.query.post({ sql: 'select 1' }, { headers: bearer(agent.apiKey) })
    expect(denied.status).toBe(403)
    await grant(agent.apiKey, project.id, ['db:read'])
    const ok = await h.api.agent.v1.query.post({ sql: 'select 1 as x' }, { headers: bearer(agent.apiKey) })
    expect(ok.status).toBe(200)

    // An engine error: valid SQL, missing table, with sufficient scope -> status 'error'.
    const errored = await h.api.agent.v1.query.post(
      { sql: 'select * from definitely_missing_table' },
      { headers: bearer(agent.apiKey) },
    )
    expect(errored.status).toBe(400)

    const res = await h.api.api.projects({ id: project.id }).activity.get()
    expect(res.status).toBe(200)
    const statuses = (res.data ?? []).map((e) => e.status)
    expect(statuses).toContain('ok')
    expect(statuses).toContain('denied')
    expect(statuses).toContain('error')
    expect(res.data?.find((e) => e.status === 'ok')?.agentName).toBe('act-bot')
    // The error event still records the classified scopes (a SELECT needs db:read).
    expect(res.data?.find((e) => e.status === 'error')?.requiredScopes).toContain('db:read')
  })

  test('activity of an inaccessible project is 404', async () => {
    const project = await newProject('act2')
    const stranger = await h.clientFor('55555555-5555-5555-5555-555555555555', { email: 'stranger5@example.com' })
    const res = await stranger.api.projects({ id: project.id }).activity.get()
    expect(res.status).toBe(404)
  })
})

describe('me + onboarding', () => {
  test('GET /api/me returns the user with onboarding not yet complete', async () => {
    const res = await h.api.api.me.get()
    expect(res.status).toBe(200)
    expect(res.data?.id).toBe(SYSTEM_USER_ID)
    expect(typeof res.data?.email).toBe('string')
    expect(res.data?.onboardingCompletedAt).toBeNull()
  })

  test('POST /api/me/onboarding/complete stamps completion and is idempotent', async () => {
    const first = await h.api.api.me.onboarding.complete.post()
    expect(first.status).toBe(200)
    const stamp = first.data?.onboardingCompletedAt
    expect(ms(stamp)).not.toBeNaN()

    // GET now reflects it…
    const me = await h.api.api.me.get()
    expect(ms(me.data?.onboardingCompletedAt)).toBe(ms(stamp))

    // …and completing again keeps the original timestamp (never rewrites it).
    const second = await h.api.api.me.onboarding.complete.post()
    expect(ms(second.data?.onboardingCompletedAt)).toBe(ms(stamp))
  })

  test('/api/me requires authentication', async () => {
    const res = await h.api.api.me.get({ headers: { authorization: '' } })
    expect(res.status).toBe(401)
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
