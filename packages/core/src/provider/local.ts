import postgres from 'postgres'
import { newDatabaseName } from '../ids.ts'
import { dropProjectRoles } from '../roles.ts'
import type { DatabaseProvider } from './types.ts'

/** Guard against interpolating anything but our own generated db names. */
function assertSafeDbName(name: string): void {
  if (!/^proj_[a-f0-9]+$/.test(name)) {
    throw new Error(`Refusing to operate on unexpected database name: ${name}`)
  }
}

function withDatabase(adminUrl: string, dbName: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${dbName}`
  return url.toString()
}

/**
 * A provider backed by the local docker Postgres. Each "project" becomes its own
 * database on that instance, which makes the whole provision → query → destroy
 * lifecycle fully exercisable in tests without touching Neon.
 */
export function createLocalProvider(adminUrl: string): DatabaseProvider {
  return {
    kind: 'local',
    async provision({ name: _name }) {
      const dbName = newDatabaseName()
      assertSafeDbName(dbName)
      const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })
      try {
        await admin.unsafe(`CREATE DATABASE "${dbName}"`)
      } finally {
        await admin.end({ timeout: 5 })
      }
      return {
        providerProjectId: dbName,
        connectionUri: withDatabase(adminUrl, dbName),
        region: 'local',
      }
    },
    async destroy(providerProjectId) {
      assertSafeDbName(providerProjectId)
      const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })
      try {
        // Drop blocks while other sessions hold the database open, so evict them first.
        await admin`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = ${providerProjectId} AND pid <> pg_backend_pid()
        `
        await admin.unsafe(`DROP DATABASE IF EXISTS "${providerProjectId}"`)
      } finally {
        await admin.end({ timeout: 5 })
      }
      // Roles are cluster-global, so they outlive the dropped database here.
      await dropProjectRoles(adminUrl, providerProjectId)
    },
  }
}
