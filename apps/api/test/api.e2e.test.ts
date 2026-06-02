import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { treaty } from '@elysiajs/eden'
import { SYSTEM_USER_ID } from '@walnut/core'
import { agentGrants, branches, organizationMembers, organizations } from '@walnut/db'
import { eq } from 'drizzle-orm'
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

async function newAgent(projectId: string, name = 'agent'): Promise<{ id: string; apiKey: string }> {
  const res = await h.api.api.projects({ id: projectId }).agents.post({ name })
  if (res.data === null) {
    throw new Error(`createAgent failed: ${JSON.stringify(res.error?.value)}`)
  }
  return res.data
}

function bearer(apiKey: string): { authorization: string } {
  return { authorization: `Bearer ${apiKey}` }
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
  test('POST /api/projects/:id/agents creates an agent with no scopes and a key', async () => {
    const project = await newProject()
    const res = await h.api.api.projects({ id: project.id }).agents.post({ name: 'bot' })
    expect(res.status).toBe(200)
    expect(res.data?.name).toBe('bot')
    expect(res.data?.scopes).toEqual([])
    expect(res.data?.apiKey.startsWith('wln_agt_')).toBe(true)
    expect(res.data?.keyPrefix.startsWith('wln_agt_')).toBe(true)
  })

  test('creating an agent under an unknown project is 404', async () => {
    const res = await h.api.api
      .projects({ id: '00000000-0000-0000-0000-0000000000ff' })
      .agents.post({ name: 'bot' })
    expect(res.status).toBe(404)
  })

  test('GET /api/projects/:id/agents lists agents', async () => {
    const project = await newProject()
    await newAgent(project.id, 'one')
    await newAgent(project.id, 'two')
    const res = await h.api.api.projects({ id: project.id }).agents.get()
    expect(res.data?.length).toBe(2)
  })

  test('GET /api/agents/:id returns the agent without its key', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    const res = await h.api.api.agents({ id: agent.id }).get()
    expect(res.data?.id).toBe(agent.id)
    expect(res.data?.keyPrefix.startsWith('wln_agt_')).toBe(true)
    expect(Object.keys(res.data ?? {})).not.toContain('apiKey')
  })

  test('DELETE /api/agents/:id removes the agent', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    const del = await h.api.api.agents({ id: agent.id }).delete()
    expect(del.data).toEqual({ deleted: true })
    const after = await h.api.api.agents({ id: agent.id }).get()
    expect(after.status).toBe(404)
  })

  // Grants are the normalized source of truth for an agent's scopes + scoped role.
  test('creating an agent provisions exactly one project-anchored grant', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    const grants = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))
    expect(grants.length).toBe(1)
    const g = grants[0]
    expect(g?.resourceType).toBe('project')
    expect(g?.resourceId).toBe(project.id)
    expect(g?.scopes).toEqual([])
    expect(typeof g?.dbRole).toBe('string')
    expect(g?.connectionUri ?? '').toContain('postgres')
  })

  test('approving a scope request writes the scopes onto the grant', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write'])
    const grants = await h.ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))
    expect(grants[0]?.scopes).toEqual(['db:read', 'db:write'])
  })
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

  test('GET /agent/v1/identity returns scopes and project', async () => {
    const project = await newProject('identity')
    const agent = await newAgent(project.id, 'ident-bot')
    const res = await h.api.agent.v1.identity.get({ headers: bearer(agent.apiKey) })
    expect(res.data?.id).toBe(agent.id)
    expect(res.data?.scopes).toEqual([])
    expect(res.data?.project?.id).toBe(project.id)
  })
})

describe('agent query scope enforcement', () => {
  test('reading without db:read is denied with a clear message', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    const res = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('insufficient_scope')
    expect(body?.missingScopes).toEqual(['db:read'])
  })

  test('an empty statement is rejected', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    const res = await h.api.agent.v1.query.post({ sql: '   ' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(400)
  })

  test('a read-only agent cannot smuggle DDL via a multi-statement batch', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
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
    const agent = await newAgent(project.id)
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    // Seed a table with a row using the privileged grant.
    await h.api.agent.v1.query.post({ sql: 'CREATE TABLE t (id int)' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO t VALUES (1)' }, { headers: auth })

    // A second, read-only agent must not be able to run EXPLAIN ANALYZE DELETE.
    const reader = await newAgent(project.id, 'reader')
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
    const agent = await newAgent(project.id)
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
    const agent = await newAgent(project.id)
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
    const agent = await newAgent(project.id)
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
    const agent = await newAgent(project.id)
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
    const agent = await newAgent(project.id)
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
    const author = await newAgent(project.id, 'author')
    await grant(author.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    const authorAuth = bearer(author.apiKey)
    await h.api.agent.v1.query.post(
      { sql: 'CREATE TABLE shared (id int)' },
      { headers: authorAuth },
    )
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO shared VALUES (42)' }, { headers: authorAuth })

    const reader = await newAgent(project.id, 'reader')
    await grant(reader.apiKey, project.id, ['db:read'])
    const read = await h.api.agent.v1.query.post(
      { sql: 'SELECT id FROM shared' },
      { headers: bearer(reader.apiKey) },
    )
    expect(read.status).toBe(200)
    expect(read.data?.rows).toEqual([{ id: 42 }])
  })
})

describe('scope requests', () => {
  test('an agent requests a scope; the dashboard sees it pending and approves it', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
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
    const project = await newProject()
    const agent = await newAgent(project.id)
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
    const project = await newProject()
    const agent = await newAgent(project.id)
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
    const project = await newProject()
    const agent = await newAgent(project.id)
    const res = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:teleport'] },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
  })

  test('an agent can list its own scope requests', async () => {
    const project = await newProject()
    const agent = await newAgent(project.id)
    const auth = bearer(agent.apiKey)
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: auth })
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:write'] }, { headers: auth })
    const list = await h.api.agent.v1['scope-requests'].get({ headers: auth })
    expect(list.data?.length).toBe(2)
  })
})

describe('org-scoped agents', () => {
  test('identity reports the agent\'s organization and home project', async () => {
    const project = await newProject('home')
    const agent = await newAgent(project.id, 'org-bot')
    const res = await h.api.agent.v1.identity.get({ headers: bearer(agent.apiKey) })
    expect(typeof res.data?.organization.id).toBe('string')
    expect(res.data?.project?.id).toBe(project.id)
  })

  test('an agent can be granted access to a second project in its org and query it', async () => {
    const home = await newProject('home-proj')
    const other = await newProject('other-proj')
    const agent = await newAgent(home.id, 'multi-bot')
    const auth = bearer(agent.apiKey)

    // Request db:read explicitly on the OTHER project (not the home/default target).
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

    // It now holds grants on two projects, so an untargeted query is ambiguous.
    const ambiguous = await h.api.agent.v1.query.post({ sql: 'select 1' }, { headers: auth })
    expect(ambiguous.status).toBe(400)
    expect((ambiguous.error?.value as ErrorBody | undefined)?.error).toBe('ambiguous_project')

    // Targeting the OTHER project (where it has db:read) succeeds over its own role.
    const ok = await h.api.agent.v1.query.post({ sql: 'select 1 as n', projectId: other.id }, { headers: auth })
    expect(ok.status).toBe(200)
    expect(ok.data?.rows).toEqual([{ n: 1 }])

    // The home project still has no scopes, so a query there is denied.
    const denied = await h.api.agent.v1.query.post({ sql: 'select 1', projectId: home.id }, { headers: auth })
    expect(denied.status).toBe(403)
  }, 20_000)

  test('requesting db scopes at the org level is rejected (no org database)', async () => {
    const project = await newProject('orglevel')
    const agent = await newAgent(project.id, 'org-req-bot')
    const orgId = await personalOrgId()
    const res = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], resourceType: 'org', resourceId: orgId },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
  })

  test('deleting a project clears its grants/requests; the org-scoped agent survives', async () => {
    const home = await newProject('keep')
    const other = await newProject('drop')
    const agent = await newAgent(home.id, 'survivor')
    const auth = bearer(agent.apiKey)

    // Grant the agent access to the second project, then delete that project.
    const req = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:read'], resourceType: 'project', resourceId: other.id },
      { headers: auth },
    )
    const id = req.data?.id
    if (id === undefined) throw new Error('no request id')
    await h.api.api['scope-requests']({ id }).approve.post()
    await h.api.api.projects({ id: other.id }).delete()

    // The grant on the deleted project is gone, so the agent has only its home project:
    // identity still resolves (no dangling reference) and an untargeted query is no longer
    // ambiguous — it falls back to the home project (where it has no scopes → 403).
    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.status).toBe(200)
    expect(identity.data?.project?.id).toBe(home.id)
    const q = await h.api.agent.v1.query.post({ sql: 'select 1' }, { headers: auth })
    expect(q.status).toBe(403)
    expect((q.error?.value as ErrorBody | undefined)?.error).toBe('insufficient_scope')
  }, 20_000)

  test('requesting access on a project in another org is 404 (no existence leak)', async () => {
    const project = await newProject('mine')
    const agent = await newAgent(project.id, 'leak-bot')
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

  /** Alice owns a provisioned project with one agent; Bob is an unrelated user. */
  async function aliceProjectWithAgent() {
    const alice = await h.clientFor(ALICE, { email: 'alice@corp.test' })
    const bob = await h.clientFor(BOB, { email: 'bob@corp.test' })
    const proj = await alice.api.projects.post({ name: 'alice-proj' })
    const projectId = proj.data?.id
    if (projectId === undefined) throw new Error(`project create failed: ${JSON.stringify(proj.error?.value)}`)
    const agentRes = await alice.api.projects({ id: projectId }).agents.post({ name: 'a-bot' })
    const agent = agentRes.data
    if (agent === null) throw new Error(`agent create failed: ${JSON.stringify(agentRes.error?.value)}`)
    return { alice, bob, projectId, agentId: agent.id, agentKey: agent.apiKey }
  }

  test("a user cannot read, delete, list, or create another user's agents", async () => {
    const { bob, projectId, agentId } = await aliceProjectWithAgent()
    expect((await bob.api.agents({ id: agentId }).get()).status).toBe(404)
    expect((await bob.api.agents({ id: agentId }).delete()).status).toBe(404)
    expect((await bob.api.projects({ id: projectId }).agents.get()).status).toBe(404)
    expect((await bob.api.projects({ id: projectId }).agents.post({ name: 'sneaky' })).status).toBe(404)
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

/** Helper: have an agent request scopes and immediately approve them as the user. */
async function grant(apiKey: string, _projectId: string, scopes: ('db:read' | 'db:write' | 'db:delete' | 'db:ddl')[]): Promise<void> {
  const reqRes = await h.api.agent.v1['scope-requests'].post({ scopes }, { headers: bearer(apiKey) })
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
    await newAgent(project.id, 'a1')
    await newAgent(project.id, 'a2')
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).projects.get()
    expect(res.status).toBe(200)
    const row = res.data?.find((p) => p.id === project.id)
    expect(row?.agentCount).toBe(2)
    expect(row?.pendingRequestCount).toBe(0)
    expect(row?.defaultBranch).toBe('main')
  })

  test('pendingRequestCount counts only open scope requests', async () => {
    const project = await newProject('pending')
    const agent = await newAgent(project.id, 'bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).projects.get()
    expect(res.data?.find((p) => p.id === project.id)?.pendingRequestCount).toBe(1)
  })

  test('GET /api/organizations/:orgId/agents is the org-wide roster with per-project grants', async () => {
    const project = await newProject('roster')
    await newAgent(project.id, 'roster-bot')
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).agents.get()
    expect(res.status).toBe(200)
    const bot = res.data?.find((a) => a.name === 'roster-bot')
    expect(bot?.grants.some((g) => g.resourceType === 'project' && g.projectName === 'roster')).toBe(true)
  })

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
    const project = await newProject('reqs')
    const agent = await newAgent(project.id, 'r-bot')
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
    const project = await newProject('iso')
    const agent = await newAgent(project.id, 'iso-bot')
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
    const agent = await newAgent(project.id, 'act-bot')

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
