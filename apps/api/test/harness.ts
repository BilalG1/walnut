import { treaty } from '@elysiajs/eden'
import { openDb, runMigrations } from '@walnut/db'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { createApp } from '../src/app.ts'
import { createContext, type OwnedContext } from '../src/context.ts'
import { ensureSeed } from '../src/seed.ts'

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://walnut:walnut@localhost:3002/postgres'
const TEST_DB = process.env.TEST_DB_NAME ?? 'walnut_test'

function withDatabase(adminUrl: string, db: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${db}`
  return url.toString()
}

const TEST_DB_URL = withDatabase(ADMIN_URL, TEST_DB)

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
  api: ReturnType<typeof treaty<ReturnType<typeof createApp>>>
  reset: () => Promise<void>
  dispose: () => Promise<void>
}

export async function createHarness(): Promise<Harness> {
  await ensureTestDatabase()

  const migrationHandle = openDb(TEST_DB_URL)
  try {
    await runMigrations(migrationHandle.db)
  } finally {
    await migrationHandle.close()
  }

  const ctx = createContext(TEST_DB_URL, { kind: 'local', localAdminUrl: ADMIN_URL })
  const app = createApp(ctx)
  const api = treaty(app)

  async function reset(): Promise<void> {
    await ctx.db.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)
    await ensureSeed(ctx)
  }

  async function dispose(): Promise<void> {
    await ctx.close()
    await dropProjectDatabases()
  }

  return { ctx, api, reset, dispose }
}
