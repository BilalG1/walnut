import { describe, expect, test } from 'bun:test'
import { agentGrants, agentGrantScopes } from '@walnut/db'
import { and, eq } from 'drizzle-orm'
import { bearer, type ErrorBody, grant, h, newAgent, newProject, personalOrgId, useHarness } from './support.ts'

useHarness()

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

  test('an expired scope is denied at the classifier; a still-valid scope keeps working', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    // Permanent read + a time-boxed write; a first query provisions the {read,write} scope role.
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

    // A still-valid read works — it now runs over the lesser {read} scoped connection.
    const read = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: auth })
    expect(read.status).toBe(200)

    // The agent's identity also reflects only the live scope.
    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.data?.scopes).toEqual(['db:read'])
  }, 25_000)

  test('when every scope lapses, queries are denied and the agent has no effective scopes', async () => {
    const project = await newProject()
    const agent = await newAgent()
    const auth = bearer(agent.apiKey)
    // A single time-boxed scope, exercised by an authorised query.
    await grantWithTtl(agent.apiKey, project.id, ['db:read'], 3600)
    const seed = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: auth })
    expect(seed.status).toBe(200)

    // The scope lapses, leaving the grant with zero effective scopes.
    await expireScope(agent.id, project.id, 'db:read')

    // The next query is denied (nothing is in force); identity reports no live scopes. There is
    // no per-agent role to leave stale — enforcement just stops selecting a scoped connection.
    const blocked = await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: auth })
    expect(blocked.status).toBe(403)
    const identity = await h.api.agent.v1.identity.get({ headers: auth })
    expect(identity.data?.scopes).toEqual([])
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

describe('cascading grants and per-branch activity', () => {
  /** Create a branch and return its id. */
  async function makeBranch(projectId: string, name: string, from?: string): Promise<string> {
    const res = await h.api.api.projects({ id: projectId }).branches.post(from === undefined ? { name } : { name, from })
    const id = res.data?.id
    if (id === undefined) {
      throw new Error(`createBranch failed: ${JSON.stringify(res.error?.value)}`)
    }
    return id
  }

  /** Grant scopes to an agent anchored to a specific branch, then approve. */
  async function grantBranch(
    apiKey: string,
    branchId: string,
    scopes: ('db:read' | 'db:write' | 'db:delete' | 'db:ddl')[],
  ): Promise<void> {
    const req = await h.api.agent.v1['scope-requests'].post(
      { scopes, resourceType: 'branch', resourceId: branchId },
      { headers: bearer(apiKey) },
    )
    const id = req.data?.id
    if (id === undefined) {
      throw new Error(`branch scope request failed: ${JSON.stringify(req.error?.value)}`)
    }
    await h.api.api['scope-requests']({ id }).approve.post()
  }

  test('a branch-anchored grant works on its branch but not on the others', async () => {
    const project = await newProject('branchgrant')
    const featureId = await makeBranch(project.id, 'feature')
    const agent = await newAgent('branch-bot')
    const auth = bearer(agent.apiKey)
    await grantBranch(agent.apiKey, featureId, ['db:read'])

    const onFeature = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n', branch: 'feature' }, { headers: auth })
    expect(onFeature.status).toBe(200)
    // No grant covers the default branch, so the same query is denied there.
    const onMain = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: auth })
    expect(onMain.status).toBe(403)
  }, 30_000)

  test('a project-level grant cascades to every branch', async () => {
    const project = await newProject('cascade')
    await makeBranch(project.id, 'feature')
    const agent = await newAgent('cascade-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read'])

    expect((await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: auth })).status).toBe(200)
    const onFeature = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n', branch: 'feature' }, { headers: auth })
    expect(onFeature.status).toBe(200)
  }, 30_000)

  test('branch and project grants union (project read+ddl, branch adds write on one branch)', async () => {
    const project = await newProject('union')
    const featureId = await makeBranch(project.id, 'feature')
    const agent = await newAgent('union-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:ddl']) // cascades to all branches
    await grantBranch(agent.apiKey, featureId, ['db:write']) // adds write only on feature

    // On feature the effective set is {read, ddl, write}: create + insert both succeed.
    expect(
      (await h.api.agent.v1.query.post({ sql: 'CREATE TABLE t (id int)', branch: 'feature' }, { headers: auth }))
        .status,
    ).toBe(200)
    const wFeature = await h.api.agent.v1.query.post(
      { sql: 'INSERT INTO t VALUES (1)', branch: 'feature' },
      { headers: auth },
    )
    expect(wFeature.status).toBe(200)

    // On main the effective set is {read, ddl} (no write): create succeeds, insert is denied.
    expect((await h.api.agent.v1.query.post({ sql: 'CREATE TABLE t (id int)' }, { headers: auth })).status).toBe(200)
    const wMain = await h.api.agent.v1.query.post({ sql: 'INSERT INTO t VALUES (1)' }, { headers: auth })
    expect(wMain.status).toBe(403)
    expect((wMain.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['db:write'])
  }, 30_000)

  test('query activity records the branch and can be filtered by it', async () => {
    const project = await newProject('actbranch')
    await makeBranch(project.id, 'feature')
    const agent = await newAgent('actbranch-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read'])
    await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n' }, { headers: auth }) // main
    await h.api.agent.v1.query.post({ sql: 'SELECT 2 AS n', branch: 'feature' }, { headers: auth }) // feature

    const all = await h.api.api.projects({ id: project.id }).activity.get()
    expect(all.data?.length).toBe(2)
    expect(new Set((all.data ?? []).map((e) => e.branch))).toEqual(new Set(['main', 'feature']))

    const onlyFeature = await h.api.api.projects({ id: project.id }).activity.get({ query: { branch: 'feature' } })
    expect(onlyFeature.data?.length).toBe(1)
    expect(onlyFeature.data?.[0]?.branch).toBe('feature')
  }, 30_000)

  test('an expired branch-grant scope drops from the union while project scopes persist', async () => {
    const project = await newProject('expunion')
    const featureId = await makeBranch(project.id, 'feature')
    const agent = await newAgent('expunion-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read']) // permanent, cascades to feature
    // A time-boxed branch write on feature.
    const req = await h.api.agent.v1['scope-requests'].post(
      { scopes: ['db:write'], expiresInSeconds: 3600, resourceType: 'branch', resourceId: featureId },
      { headers: auth },
    )
    await h.api.api['scope-requests']({ id: req.data?.id ?? '' }).approve.post()

    // While valid, a write passes the classifier (engine then errors on the missing table → 400).
    const before = await h.api.agent.v1.query.post(
      { sql: 'INSERT INTO t VALUES (1)', branch: 'feature' },
      { headers: auth },
    )
    expect(before.status).toBe(400)

    // Expire the branch write scope directly.
    const [bg] = await h.ctx.db
      .select()
      .from(agentGrants)
      .where(
        and(
          eq(agentGrants.agentId, agent.id),
          eq(agentGrants.resourceType, 'branch'),
          eq(agentGrants.resourceId, featureId),
        ),
      )
    await h.ctx.db
      .update(agentGrantScopes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(agentGrantScopes.grantId, bg?.id ?? ''), eq(agentGrantScopes.scope, 'db:write')))

    // Write is now denied (dropped from the union); the cascaded project read still works.
    const after = await h.api.agent.v1.query.post(
      { sql: 'INSERT INTO t VALUES (1)', branch: 'feature' },
      { headers: auth },
    )
    expect(after.status).toBe(403)
    expect((after.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['db:write'])
    const read = await h.api.agent.v1.query.post({ sql: 'SELECT 1 AS n', branch: 'feature' }, { headers: auth })
    expect(read.status).toBe(200)
  }, 30_000)

  test('a denied query is recorded against the branch it targeted', async () => {
    const project = await newProject('denybranch')
    await makeBranch(project.id, 'feature')
    const agent = await newAgent('denybranch-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read']) // read only → a write is denied
    const denied = await h.api.agent.v1.query.post(
      { sql: 'INSERT INTO t VALUES (1)', branch: 'feature' },
      { headers: auth },
    )
    expect(denied.status).toBe(403)

    const acts = await h.api.api.projects({ id: project.id }).activity.get({ query: { branch: 'feature' } })
    expect(acts.data?.length).toBe(1)
    expect(acts.data?.[0]?.status).toBe('denied')
    expect(acts.data?.[0]?.branch).toBe('feature')
  }, 30_000)
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

