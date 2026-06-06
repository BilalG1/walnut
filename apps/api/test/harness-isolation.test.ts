import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { ADMIN_URL, dropDatabasesWithPrefix } from './harness.ts'

/**
 * Regression for the cross-environment data-loss bug (F1-a): the suite's per-project DB cleanup
 * MUST be prefix-scoped. A blanket `proj_%` sweep would also drop a co-located local dev stack's
 * real databases (which share the default `proj_` prefix) and the parallel cli suite's. This test
 * stands up three databases under different prefixes and proves that dropping one prefix leaves the
 * others — including a dev-style `proj_*` one — untouched.
 */
describe('harness db cleanup isolation', () => {
  const KEEP_DEV = 'proj_isolationkeep01' // mimics the local dev stack — must survive
  const KEEP_SUITE = 'isokeepsuite_isolationkeep01' // mimics another parallel suite — must survive
  const DROP = 'isodropsuite_isolationdrop01' // the prefix under test — must be dropped
  const ALL = [KEEP_DEV, KEEP_SUITE, DROP]

  async function withAdmin<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    const sql = postgres(ADMIN_URL, { max: 1, prepare: false })
    try {
      return await fn(sql)
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
  function exists(name: string): Promise<boolean> {
    return withAdmin(async (sql) => (await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`).length > 0)
  }
  async function dropAll(): Promise<void> {
    await withAdmin(async (sql) => {
      for (const name of ALL) {
        // eslint-disable-next-line no-await-in-loop
        await sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`)
      }
    })
  }

  beforeAll(async () => {
    await dropAll()
    await withAdmin(async (sql) => {
      for (const name of ALL) {
        // eslint-disable-next-line no-await-in-loop
        await sql.unsafe(`CREATE DATABASE "${name}"`)
      }
    })
  }, 30_000)

  afterAll(dropAll)

  test('dropDatabasesWithPrefix drops only its own prefix, never others', async () => {
    await dropDatabasesWithPrefix(ADMIN_URL, 'isodropsuite')
    expect(await exists(DROP)).toBe(false)
    // A dev-style proj_* database and a sibling suite's database are left untouched.
    expect(await exists(KEEP_DEV)).toBe(true)
    expect(await exists(KEEP_SUITE)).toBe(true)
  }, 30_000)
})
