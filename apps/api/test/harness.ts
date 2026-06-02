import { treaty } from '@elysiajs/eden'
import { SYSTEM_USER_ID } from '@walnut/core'
import { localPostgresUrl } from '@walnut/core/ports'
import { openDb, runMigrations } from '@walnut/db'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { createApp } from '../src/app.ts'
import { createTestAuth, type TestAuth } from '../src/auth/test-auth.ts'
import { createContext, type OwnedContext } from '../src/context.ts'
import { ensureSeed } from '../src/seed.ts'

const ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL?.trim() || localPostgresUrl({ database: 'postgres', prefix: process.env.PORT_PREFIX })
const TEST_DB = process.env.TEST_DB_NAME ?? 'walnut_test'

function withDatabase(adminUrl: string, db: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${db}`
  return url.toString()
}

const TEST_DB_URL = withDatabase(ADMIN_URL, TEST_DB)

type ApiClient = ReturnType<typeof treaty<ReturnType<typeof createApp>>>

function bearerHeaders(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

async function ensureTestDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, prepare: false })
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`)
    }
  } finally {
    await admin.end({ timeout: 5 })
  }
}

/** Reset the metadata schema to a clean slate so freshly regenerated migrations
 * apply without colliding with a prior run's tables/migration journal. */
async function resetSchema(): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    // Evict any lingering sessions (e.g. a prior run still closing) so DROP SCHEMA
    // can't block on their locks; the lock_timeout then fails fast instead of hanging.
    await client.unsafe(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()',
    )
    await client.unsafe("SET lock_timeout = '15s'")
    await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await client.unsafe('CREATE SCHEMA public')
  } finally {
    await client.end({ timeout: 5 })
  }
}

/** Drop every per-project database the local provider created during a test run. */
async function dropProjectDatabases(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, prepare: false })
  try {
    const rows = await admin<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE 'proj_%'
    `
    for (const { datname } of rows) {
      // Sequential by design: terminate the database's sessions, then drop it,
      // all over a single admin connection. Parallelising would race.
      // eslint-disable-next-line no-await-in-loop
      await admin`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = ${datname} AND pid <> pg_backend_pid()
      `
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}"`)
    }
    // Per-project roles are cluster-global, so they outlive the dropped databases.
    const roles = await admin<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname ^@ 'proj_'
    `
    for (const { rolname } of roles) {
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP OWNED BY "${rolname}"`)
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP ROLE IF EXISTS "${rolname}"`)
    }
  } finally {
    await admin.end({ timeout: 5 })
  }
}

export interface Harness {
  ctx: OwnedContext
  /** Dashboard client pre-authed as the seeded system user. */
  api: ApiClient
  /** Mint a Hexclave-shaped access token for any user id (exercises real verification). */
  mintToken: TestAuth['mintToken']
  /** A dashboard client authed as the given user — for multi-user isolation tests. */
  clientFor: (userId: string, claims?: { email?: string; name?: string }) => Promise<ApiClient>
  reset: () => Promise<void>
  dispose: () => Promise<void>
}

export async function createHarness(): Promise<Harness> {
  await ensureTestDatabase()
  await resetSchema()

  const migrationHandle = openDb(TEST_DB_URL)
  try {
    await runMigrations(migrationHandle.db)
  } finally {
    await migrationHandle.close()
  }

  const { verifier, mintToken } = await createTestAuth()
  const ctx = createContext(TEST_DB_URL, { kind: 'local', localAdminUrl: ADMIN_URL }, verifier)
  const app = createApp(ctx)

  // Every request from `api` is authed as the seeded system user, so existing tests
  // (which don't pass auth) keep working. Per-call headers (agent keys) override this.
  const systemToken = await mintToken(SYSTEM_USER_ID, { email: 'system@walnut.cloud', name: 'System' })
  const api: ApiClient = treaty(app, { headers: bearerHeaders(systemToken) })

  async function clientFor(
    userId: string,
    claims: { email?: string; name?: string } = {},
  ): Promise<ApiClient> {
    const token = await mintToken(userId, claims)
    return treaty(app, { headers: bearerHeaders(token) })
  }

  async function reset(): Promise<void> {
    await ctx.db.execute(sql`TRUNCATE TABLE users, organizations RESTART IDENTITY CASCADE`)
    await ensureSeed(ctx)
  }

  async function dispose(): Promise<void> {
    await ctx.close()
    await dropProjectDatabases()
  }

  return { ctx, api, mintToken, clientFor, reset, dispose }
}
