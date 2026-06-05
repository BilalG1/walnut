import { describe, expect, test } from 'bun:test'
import { runSql } from '@walnut/core'
import { branches } from '@walnut/db'
import { and, eq } from 'drizzle-orm'
import { bearer, type ErrorBody, grant, h, newAgent, newProject, useHarness } from './support.ts'

useHarness()

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

  test('a non-UUID project id is a clean 422, not a 500 from the uuid cast', async () => {
    // A well-formed-but-missing UUID is a 404 (above); a malformed id is rejected by the param
    // schema before it can reach the Postgres `uuid` cast (which would otherwise be a 500).
    const res = await h.api.api.projects({ id: 'not-a-uuid' }).get()
    expect(res.status).toBe(422)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('validation')

    // The branch segment is a name (text), so it never casts — a bad branch on a real project
    // is still a clean 404, and a bad project id under the branch route is still the 422.
    const project = await newProject('branchy-422')
    const badBranch = await h.api.api.projects({ id: project.id }).branches({ branch: 'nope' }).get()
    expect(badBranch.status).toBe(404)
    const badProj = await h.api.api.projects({ id: 'nope' }).branches({ branch: 'main' }).get()
    expect(badProj.status).toBe(422)
  })

  test('DELETE /api/projects/:id removes the project', async () => {
    const project = await newProject('to-delete')
    const del = await h.api.api.projects({ id: project.id }).delete()
    expect(del.data).toEqual({ deleted: true })
    const after = await h.api.api.projects({ id: project.id }).get()
    expect(after.status).toBe(404)
  })

  test('deleting a project drops its branch databases and their cluster-global roles', async () => {
    const project = await newProject('teardown')
    const agent = await newAgent('teardown-bot')
    await grant(agent.apiKey, project.id, ['db:read'])
    // A query provisions a scope role on the main branch's database, on top of its group roles.
    await h.api.agent.v1.query.post({ sql: 'SELECT 1' }, { headers: bearer(agent.apiKey) })

    const [main] = await h.ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.projectId, project.id), eq(branches.isDefault, true)))
    const dbName = main?.providerBranchId ?? ''
    const ownerUri = main?.connectionUri ?? ''
    // Reach the cluster over a neutral database to inspect catalogs after the branch db is dropped.
    const adminUri = new URL(ownerUri)
    adminUri.pathname = '/postgres'
    const admin = adminUri.toString()

    const before = await runSql(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    expect(before.rows.length).toBe(1)

    await h.api.api.projects({ id: project.id }).delete()

    const dbGone = await runSql(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    expect(dbGone.rows.length).toBe(0)
    const rolesGone = await runSql(admin, 'SELECT rolname FROM pg_roles WHERE rolname LIKE $1', [`${dbName}\\_%`])
    expect(rolesGone.rows.length).toBe(0)
  }, 20_000)
})

describe('branches', () => {
  test('GET /api/projects/:id/branches returns the default main branch', async () => {
    const project = await newProject('branchy')
    const res = await h.api.api.projects({ id: project.id }).branches.get()
    expect(res.status).toBe(200)
    expect(res.data?.length).toBe(1)
    expect(res.data?.[0]?.name).toBe('main')
    expect(res.data?.[0]?.isDefault).toBe(true)
    expect(res.data?.[0]?.status).toBe('active')
  })

  test('the main branch owns its own provisioned database (identity lives on the branch)', async () => {
    const project = await newProject('branchy-db')
    const [main] = await h.ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.projectId, project.id), eq(branches.isDefault, true)))
    expect(main?.status).toBe('active')
    expect(main?.connectionUri ?? '').toContain('postgres')
    expect(typeof main?.providerBranchId).toBe('string')
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

  test('POST creates a branch with its own active database', async () => {
    const project = await newProject('makebranch')
    const res = await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })
    expect(res.status).toBe(200)
    expect(res.data?.name).toBe('feature')
    expect(res.data?.isDefault).toBe(false)
    expect(res.data?.status).toBe('active')
    const list = await h.api.api.projects({ id: project.id }).branches.get()
    expect((list.data ?? []).map((b) => b.name).toSorted()).toEqual(['feature', 'main'])
  }, 20_000)

  test('a branch is an isolated copy-on-write clone of its source', async () => {
    const project = await newProject('cow')
    const agent = await newAgent('cow-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    // Seed main, then branch it: the row present at branch time is copied.
    await h.api.agent.v1.query.post({ sql: 'CREATE TABLE items (id int)' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO items VALUES (1)' }, { headers: auth })
    const br = await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })
    expect(br.status).toBe(200)

    const onBranch = await h.api.agent.v1.query.post(
      { sql: 'SELECT count(*)::int AS c FROM items', branch: 'feature' },
      { headers: auth },
    )
    expect(onBranch.data?.rows).toEqual([{ c: 1 }])

    // A write on the branch does not appear on main, and a later write on main does not appear
    // on the branch — the two databases have diverged.
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO items VALUES (2)', branch: 'feature' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO items VALUES (3)' }, { headers: auth })
    const mainCount = await h.api.agent.v1.query.post({ sql: 'SELECT count(*)::int AS c FROM items' }, { headers: auth })
    expect(mainCount.data?.rows).toEqual([{ c: 2 }]) // 1 (seed) + 3 (its own later write)
    const branchCount = await h.api.agent.v1.query.post(
      { sql: 'SELECT count(*)::int AS c FROM items', branch: 'feature' },
      { headers: auth },
    )
    expect(branchCount.data?.rows).toEqual([{ c: 2 }]) // 1 (copied) + 2 (its own insert)
  }, 30_000)

  test('a branch can be created from a non-default source branch', async () => {
    const project = await newProject('chain')
    const agent = await newAgent('chain-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    // Build up state on a first branch, then branch *that* (not main).
    await h.api.api.projects({ id: project.id }).branches.post({ name: 'staging' })
    await h.api.agent.v1.query.post({ sql: 'CREATE TABLE s (id int)', branch: 'staging' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO s VALUES (1)', branch: 'staging' }, { headers: auth })

    const child = await h.api.api.projects({ id: project.id }).branches.post({ name: 'staging-copy', from: 'staging' })
    expect(child.status).toBe(200)
    // The child sees staging's table+row; main never had it.
    const onChild = await h.api.agent.v1.query.post(
      { sql: 'SELECT count(*)::int AS c FROM s', branch: 'staging-copy' },
      { headers: auth },
    )
    expect(onChild.data?.rows).toEqual([{ c: 1 }])
    const onMain = await h.api.agent.v1.query.post(
      { sql: "SELECT to_regclass('public.s') AS t" },
      { headers: auth },
    )
    expect(onMain.data?.rows).toEqual([{ t: null }])
  }, 30_000)

  test('a duplicate branch name is rejected with 409', async () => {
    const project = await newProject('dup')
    const first = await h.api.api.projects({ id: project.id }).branches.post({ name: 'dev' })
    expect(first.status).toBe(200)
    const again = await h.api.api.projects({ id: project.id }).branches.post({ name: 'dev' })
    expect(again.status).toBe(409)
  }, 20_000)

  test('an invalid branch name is rejected with 400', async () => {
    const project = await newProject('badname')
    const res = await h.api.api.projects({ id: project.id }).branches.post({ name: 'has spaces' })
    expect(res.status).toBe(400)
  })

  test('the default branch cannot be deleted', async () => {
    const project = await newProject('keepmain')
    const res = await h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).delete()
    expect(res.status).toBe(400)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('cannot_delete_default')
  })

  test('deleting a branch drops its database and roles; the project and main are untouched', async () => {
    const project = await newProject('delbranch')
    const agent = await newAgent('delbranch-bot')
    await grant(agent.apiKey, project.id, ['db:read'])
    const br = await h.api.api.projects({ id: project.id }).branches.post({ name: 'temp' })
    const branchId = br.data?.id ?? ''
    // A query provisions a scope role on the branch's database.
    await h.api.agent.v1.query.post({ sql: 'SELECT 1', branch: 'temp' }, { headers: bearer(agent.apiKey) })
    const [row] = await h.ctx.db.select().from(branches).where(eq(branches.id, branchId))
    const dbName = row?.providerBranchId ?? ''
    const adminUri = new URL(row?.connectionUri ?? '')
    adminUri.pathname = '/postgres'
    const admin = adminUri.toString()
    expect((await runSql(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rows.length).toBe(1)

    const del = await h.api.api.projects({ id: project.id }).branches({ branch: 'temp' }).delete()
    expect(del.data).toEqual({ deleted: true })

    expect((await runSql(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rows.length).toBe(0)
    expect((await runSql(admin, 'SELECT 1 FROM pg_roles WHERE rolname LIKE $1', [`${dbName}\\_%`])).rows.length).toBe(0)
    const remaining = await h.api.api.projects({ id: project.id }).branches.get()
    expect((remaining.data ?? []).map((b) => b.name)).toEqual(['main'])
  }, 30_000)

  test('deleting an unknown branch is 404', async () => {
    const project = await newProject('nobranch')
    const res = await h.api.api.projects({ id: project.id }).branches({ branch: 'ghost' }).delete()
    expect(res.status).toBe(404)
  })

  test('the per-branch data-viewer sql route reads the targeted branch', async () => {
    const project = await newProject('viewer')
    const agent = await newAgent('viewer-bot')
    const auth = bearer(agent.apiKey)
    await grant(agent.apiKey, project.id, ['db:read', 'db:write', 'db:ddl'])
    await h.api.agent.v1.query.post({ sql: 'CREATE TABLE t (id int)' }, { headers: auth })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO t VALUES (7)' }, { headers: auth })
    await h.api.api.projects({ id: project.id }).branches.post({ name: 'b2' })
    await h.api.agent.v1.query.post({ sql: 'INSERT INTO t VALUES (8)', branch: 'b2' }, { headers: auth })

    const main = await h.api.api.projects({ id: project.id }).sql.post({ sql: 'SELECT count(*)::int AS c FROM t' })
    expect(main.data?.rows).toEqual([{ c: 1 }])
    const b2 = await h.api.api
      .projects({ id: project.id })
      .branches({ branch: 'b2' })
      .sql.post({ sql: 'SELECT count(*)::int AS c FROM t' })
    expect(b2.data?.rows).toEqual([{ c: 2 }])
  }, 30_000)
})

// The denormalized ancestry array is what the storage manifest resolves reads over, so branch
// creation must maintain it correctly — and creating a branch must stay O(1) (one row insert).
describe('branch ancestry', () => {
  async function defaultBranch(projectId: string) {
    const [row] = await h.ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.projectId, projectId), eq(branches.isDefault, true)))
    return row
  }
  async function branchRow(id: string) {
    const [row] = await h.ctx.db.select().from(branches).where(eq(branches.id, id))
    return row
  }

  test('main is self-rooted: no parent, ancestry = [self]', async () => {
    const project = await newProject('anc-main')
    const main = await defaultBranch(project.id)
    expect(main?.parentId).toBeNull()
    expect(main?.ancestry).toEqual([main?.id ?? ''])
  })

  test('a branch forked from main has ancestry [self, main] and parentId = main', async () => {
    const project = await newProject('anc-fork')
    const main = await defaultBranch(project.id)
    const child = await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })
    const row = await branchRow(child.data?.id ?? '')
    expect(row?.parentId).toBe(main?.id ?? '')
    expect(row?.ancestry).toEqual([child.data?.id ?? '', main?.id ?? ''])
  })

  test('a deep fork chains ancestry nearest-first ([self, parent, …, root])', async () => {
    const project = await newProject('anc-deep')
    const main = await defaultBranch(project.id)
    const staging = await h.api.api.projects({ id: project.id }).branches.post({ name: 'staging' })
    const copy = await h.api.api
      .projects({ id: project.id })
      .branches.post({ name: 'staging-copy', from: 'staging' })
    const row = await branchRow(copy.data?.id ?? '')
    expect(row?.parentId).toBe(staging.data?.id ?? '')
    expect(row?.ancestry).toEqual([copy.data?.id ?? '', staging.data?.id ?? '', main?.id ?? ''])
  }, 30_000)

  test('a branch with children cannot be deleted (409 branch_has_children)', async () => {
    const project = await newProject('anc-children')
    await h.api.api.projects({ id: project.id }).branches.post({ name: 'parent' })
    await h.api.api.projects({ id: project.id }).branches.post({ name: 'kid', from: 'parent' })
    const del = await h.api.api.projects({ id: project.id }).branches({ branch: 'parent' }).delete()
    expect(del.status).toBe(409)
    expect((del.error?.value as ErrorBody | undefined)?.error).toBe('branch_has_children')
  }, 30_000)
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

