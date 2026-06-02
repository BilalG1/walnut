import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { agentGrants, organizationMembers, organizations } from '@walnut/db'
import { eq } from 'drizzle-orm'
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
    expect(res.data?.project.id).toBe(project.id)
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

/** Helper: have an agent request scopes and immediately approve them as the user. */
async function grant(apiKey: string, _projectId: string, scopes: ('db:read' | 'db:write' | 'db:delete' | 'db:ddl')[]): Promise<void> {
  const reqRes = await h.api.agent.v1['scope-requests'].post({ scopes }, { headers: bearer(apiKey) })
  const id = reqRes.data?.id
  if (id === undefined) {
    throw new Error(`scope request failed: ${JSON.stringify(reqRes.error?.value)}`)
  }
  await h.api.api['scope-requests']({ id }).approve.post()
}
