import postgres from 'postgres'
import { newDatabaseName } from '../ids.ts'
import { dropProjectRoles } from '../roles.ts'
import type { CreateBranchInput, DatabaseProvider, DestroyBranchInput, ProvisionedDatabase } from './types.ts'

function withDatabase(adminUrl: string, dbName: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${dbName}`
  return url.toString()
}

/**
 * A provider backed by the local docker Postgres. Each *branch* becomes its own database on
 * that instance — a project's default branch and any later branch alike — which makes the whole
 * provision → branch → query → destroy lifecycle fully exercisable in tests without Neon. There
 * is no container ("project") object: branches are independent databases, so `providerProjectId`
 * is always `null` and teardown happens one branch at a time.
 *
 * `dbPrefix` (default `proj`) namespaces the per-branch databases this provider creates and
 * operates on; parallel test suites pass distinct prefixes so they never touch each other's
 * databases.
 */
export function createLocalProvider(adminUrl: string, dbPrefix = 'proj'): DatabaseProvider {
  if (!/^[a-z]+$/.test(dbPrefix)) {
    throw new Error(`Invalid local db prefix (expected [a-z]+): ${dbPrefix}`)
  }
  const safeDbName = new RegExp(`^${dbPrefix}_[a-f0-9]+$`)
  // Guard against interpolating anything but our own generated db names.
  function assertSafeDbName(name: string): void {
    if (!safeDbName.test(name)) {
      throw new Error(`Refusing to operate on unexpected database name: ${name}`)
    }
  }

  async function withAdmin<T>(fn: (admin: postgres.Sql) => Promise<T>): Promise<T> {
    const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })
    try {
      return await fn(admin)
    } finally {
      await admin.end({ timeout: 5 })
    }
  }

  /** Create a database, optionally cloning an existing branch database via `TEMPLATE` (a real
   * point-in-time copy — the local parallel to Neon's copy-on-write branching). */
  async function createDatabase(fromDbName: string | null): Promise<ProvisionedDatabase> {
    const dbName = newDatabaseName(dbPrefix)
    assertSafeDbName(dbName)
    await withAdmin(async (admin) => {
      if (fromDbName === null) {
        await admin.unsafe(`CREATE DATABASE "${dbName}"`)
        return
      }
      assertSafeDbName(fromDbName)
      // `CREATE DATABASE ... TEMPLATE` requires no other sessions on the source. Evict them,
      // then create — retrying a few times in case a scoped role reconnects in the tiny gap
      // between the terminate and the CREATE ("source database is being accessed by other users").
      for (let attempt = 0; ; attempt++) {
        // eslint-disable-next-line no-await-in-loop
        await admin`
          SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = ${fromDbName} AND pid <> pg_backend_pid()
        `
        try {
          // eslint-disable-next-line no-await-in-loop
          await admin.unsafe(`CREATE DATABASE "${dbName}" TEMPLATE "${fromDbName}"`)
          return
        } catch (err) {
          if (attempt >= 4 || !/being accessed by other users/i.test(String(err))) {
            throw err
          }
        }
      }
    })
    return { providerBranchId: dbName, connectionUri: withDatabase(adminUrl, dbName), region: 'local' }
  }

  async function destroyDatabase(dbName: string): Promise<void> {
    assertSafeDbName(dbName)
    await withAdmin(async (admin) => {
      // Drop blocks while other sessions hold the database open, so evict them first.
      await admin`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = ${dbName} AND pid <> pg_backend_pid()
      `
      await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`)
    })
    // Roles are cluster-global, so they outlive the dropped database here.
    await dropProjectRoles(adminUrl, dbName)
  }

  return {
    kind: 'local',
    async provisionProject() {
      const defaultBranch = await createDatabase(null)
      return { providerProjectId: null, defaultBranch }
    },
    async createBranch({ fromProviderBranchId }: CreateBranchInput) {
      return createDatabase(fromProviderBranchId)
    },
    async destroyBranch({ providerBranchId }: DestroyBranchInput) {
      await destroyDatabase(providerBranchId)
    },
    async destroyProject() {
      // Flat provider: no container to destroy — branches are dropped individually.
    },
  }
}
