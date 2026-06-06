import { treaty } from '@elysiajs/eden'
import { createRateLimiter, SYSTEM_USER_ID } from '@walnut/core'
import { localPostgresUrl, localS3Endpoint } from '@walnut/core/ports'
import { openDb, runMigrations } from '@walnut/db'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { createApp } from '../src/app.ts'
import { createTestAuth, type TestAuth } from '../src/auth/test-auth.ts'
import { createContext, type OwnedContext } from '../src/context.ts'
import { ensureSeed } from '../src/seed.ts'

export const ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL?.trim() || localPostgresUrl({ database: 'postgres', prefix: process.env.PORT_PREFIX })
const TEST_DB = process.env.TEST_DB_NAME ?? 'walnut_test'
/** Per-project database prefix for THIS suite — distinct from the local dev stack's `proj_*` and
 * the cli suite's `clitest_*`. Cleanup is scoped to it, so a test run can never drop another
 * environment's (or a parallel suite's) databases. */
export const DB_PREFIX = 'apitest'

function withDatabase(adminUrl: string, db: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${db}`
  return url.toString()
}

const TEST_DB_URL = withDatabase(ADMIN_URL, TEST_DB)

/** Blob store for tests: the local MinIO (derived from PORT_PREFIX) with the docker-compose
 * root credentials. Keys are project-prefixed, so the shared `walnut` bucket stays isolated
 * per (random) project across suites. */
const TEST_BLOB_CONFIG = {
  kind: 'local' as const,
  endpoint: process.env.STORAGE_ENDPOINT?.trim() || localS3Endpoint(process.env.PORT_PREFIX),
  bucket: process.env.STORAGE_BUCKET?.trim() || 'walnut',
  accessKeyId: process.env.STORAGE_ACCESS_KEY_ID?.trim() || 'walnut',
  secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || 'walnutminio',
  region: 'auto',
}

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

/** Drop only the per-project databases + roles created under `prefix` (e.g. this suite's
 * `apitest_*`). Prefix-scoped on purpose: a bare `proj_%` sweep would also drop a co-located local
 * dev stack's real `proj_*` databases and the parallel cli suite's `clitest_*`, so cleanup must
 * target exactly the artifacts this suite owns. Exported for the isolation regression test. */
export async function dropDatabasesWithPrefix(adminUrl: string, prefix: string): Promise<void> {
  const scoped = `${prefix}_`
  const admin = postgres(adminUrl, { max: 1, prepare: false })
  try {
    const rows = await admin<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname ^@ ${scoped}`
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
    const roles = await admin<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname ^@ ${scoped}`
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
  // Frozen-clock limiter so rate-limit tests are deterministic (no refill mid-test); reset()
  // clears its buckets between cases so a test's requests never spill into the next.
  const rateLimiter = createRateLimiter(() => 1_000_000)
  const ctx = createContext(
    TEST_DB_URL,
    { kind: 'local', localAdminUrl: ADMIN_URL, localDbPrefix: DB_PREFIX },
    TEST_BLOB_CONFIG,
    verifier,
    rateLimiter,
  )
  // Storage e2e tests upload/download real bytes through MinIO, so the bucket must exist.
  await ctx.blobProvider.ensureBucket()
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
    ctx.rateLimiter.reset()
    await ctx.db.execute(sql`TRUNCATE TABLE users, organizations RESTART IDENTITY CASCADE`)
    await ensureSeed(ctx)
  }

  async function dispose(): Promise<void> {
    await ctx.close()
    await dropDatabasesWithPrefix(ADMIN_URL, DB_PREFIX)
  }

  return { ctx, api, mintToken, clientFor, reset, dispose }
}
