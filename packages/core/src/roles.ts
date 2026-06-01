import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { type AgentScope, DB_SCOPES, type DbScope } from './scopes.ts'

/**
 * Per-agent Postgres roles — the real enforcement boundary.
 *
 * Each project database gets four `NOLOGIN` group roles (one per scope). Each
 * agent gets its own `LOGIN` role that is a *member* of the group roles matching
 * its granted scopes, so approval/denial is just `GRANT`/`REVOKE` of membership.
 * Agent queries run over the agent's restricted connection — never the project
 * owner connection — so even a query the SQL classifier mis-reads is still
 * refused by the database engine.
 *
 * All DDL here runs over the project *owner* connection (the connection string we
 * already store on the project). That connection is platform-only from now on and
 * is never handed to an agent.
 */

const SCOPE_SUFFIX: Record<DbScope, string> = {
  'db:read': 'read',
  'db:write': 'write',
  'db:delete': 'delete',
  'db:ddl': 'ddl',
}

/** Roles/identifiers we generate only ever contain `[A-Za-z0-9_]`; reject anything else. */
function ident(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to use unsafe SQL identifier: ${name}`)
  }
  return `"${name}"`
}

/** The database name embedded in a connection URI — used to namespace roles so they
 * stay unique in a shared cluster (the local provider keeps every project DB in one). */
function dbName(ownerUri: string): string {
  const path = new URL(ownerUri).pathname.replace(/^\//, '')
  if (path === '') {
    throw new Error('Owner connection URI has no database name')
  }
  return path
}

function groupRole(prefix: string, scope: DbScope): string {
  return `${prefix}_${SCOPE_SUFFIX[scope]}`
}

/** Name of an agent's login role, derived from the DB prefix + a random suffix. */
function newAgentRoleName(prefix: string): string {
  return `${prefix}_a_${randomBytes(8).toString('hex')}`
}

function buildAgentUri(ownerUri: string, role: string, password: string): string {
  const url = new URL(ownerUri)
  url.username = role
  // Invariant: the password must be URL-safe. We only ever pass hex here, so the
  // URL percent-encoding round-trip is a no-op. If password generation ever gains
  // characters like @ : / ? # %, build the URI without relying on URL encoding.
  url.password = password
  return url.toString()
}

async function withAdmin<T>(ownerUri: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const admin = postgres(ownerUri, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 })
  try {
    return await fn(admin)
  } finally {
    await admin.end({ timeout: 5 })
  }
}

/**
 * Create the four scope group roles for a freshly provisioned database, lock down
 * the implicit `PUBLIC` grants, and grant each group its privileges. Idempotent.
 */
export async function setupProjectRoles(ownerUri: string): Promise<void> {
  const prefix = dbName(ownerUri)
  const read = groupRole(prefix, 'db:read')
  const write = groupRole(prefix, 'db:write')
  const del = groupRole(prefix, 'db:delete')
  const ddl = groupRole(prefix, 'db:ddl')

  const createRole = (name: string) =>
    `DO $$ BEGIN CREATE ROLE ${ident(name)} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

  // Large objects have their own privilege system and PUBLIC can create/write them
  // via these pg_catalog functions — a write/storage bypass for a read-only agent.
  // Revoke the create/write/export ones from PUBLIC (signatures resolved at runtime
  // so this is robust across Postgres versions). lo_get/loread stay readable.
  // Best-effort per function: managed Postgres (e.g. Neon) won't let a non-superuser
  // owner revoke privileges on catalog functions it doesn't own — skip those rather
  // than fail provisioning.
  const lockDownLargeObjects = `DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure FROM pg_proc
    WHERE proname IN ('lo_create','lo_creat','lo_import','lo_from_bytea','lo_put',
                      'lo_unlink','lowrite','lo_truncate','lo_truncate64','lo_export')
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;`

  const sql = [
    createRole(read),
    createRole(write),
    createRole(del),
    createRole(ddl),
    // Deny-by-default: strip the implicit PUBLIC privileges on the schema, plus
    // PUBLIC's connect/temp on the database (also isolates tenants that share a
    // cluster, as the local provider does).
    `REVOKE ALL ON SCHEMA public FROM PUBLIC;`,
    `REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(prefix)} FROM PUBLIC;`,
    lockDownLargeObjects,
    // db:read
    `GRANT USAGE ON SCHEMA public TO ${ident(read)};`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ident(read)};`,
    // db:write (sequences needed for serial/identity inserts)
    `GRANT USAGE ON SCHEMA public TO ${ident(write)};`,
    `GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${ident(write)};`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${ident(write)};`,
    // db:delete
    `GRANT USAGE ON SCHEMA public TO ${ident(del)};`,
    `GRANT DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO ${ident(del)};`,
    // db:ddl (schema-level create; ownership of altered/dropped objects is the known rough edge)
    `GRANT CREATE, USAGE ON SCHEMA public TO ${ident(ddl)};`,
    // Owner-created objects flow their privileges to the group roles automatically.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ident(read)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE ON TABLES TO ${ident(write)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${ident(write)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT DELETE, TRUNCATE ON TABLES TO ${ident(del)};`,
  ].join('\n')

  await withAdmin(ownerUri, (admin) => admin.unsafe(sql))
}

export interface AgentRole {
  /** The agent's Postgres role name. */
  role: string
  /** Connection string scoped to that role (carries its generated password). */
  connectionUri: string
}

/**
 * Create an agent's login role with zero scope memberships (matching the
 * zero-scopes-at-birth model), a `statement_timeout`, and default privileges so
 * any tables the agent later creates are reachable by the other group roles.
 */
export async function createAgentRole(ownerUri: string): Promise<AgentRole> {
  const prefix = dbName(ownerUri)
  const role = newAgentRoleName(prefix)
  const password = randomBytes(24).toString('hex')
  const read = groupRole(prefix, 'db:read')
  const write = groupRole(prefix, 'db:write')
  const del = groupRole(prefix, 'db:delete')

  const sql = [
    `DO $$ BEGIN CREATE ROLE ${ident(role)} LOGIN PASSWORD '${password}'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `GRANT CONNECT ON DATABASE ${ident(prefix)} TO ${ident(role)};`,
    `ALTER ROLE ${ident(role)} SET statement_timeout = '15s';`,
    // `ALTER DEFAULT PRIVILEGES FOR ROLE <agent>` requires the executor to hold the
    // SET option on that role. A superuser owner (local) has it implicitly, but a
    // non-superuser owner (Neon) does not — so grant it explicitly first, or every
    // agent creation 500s in production.
    `GRANT ${ident(role)} TO CURRENT_USER WITH SET TRUE;`,
    // Tables this agent creates become reachable by the group roles per scope.
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(role)} IN SCHEMA public GRANT SELECT ON TABLES TO ${ident(read)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(role)} IN SCHEMA public GRANT INSERT, UPDATE ON TABLES TO ${ident(write)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(role)} IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${ident(write)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(role)} IN SCHEMA public GRANT DELETE, TRUNCATE ON TABLES TO ${ident(del)};`,
  ].join('\n')

  await withAdmin(ownerUri, (admin) => admin.unsafe(sql))
  return { role, connectionUri: buildAgentUri(ownerUri, role, password) }
}

/** Make an agent's group memberships exactly match the DB scopes in `scopes`
 * (GRANT/REVOKE the diff). Non-DB scopes have no group role and are ignored. */
export async function syncAgentScopes(
  ownerUri: string,
  agentRole: string,
  scopes: readonly AgentScope[],
): Promise<void> {
  const prefix = dbName(ownerUri)
  const held = new Set<string>(scopes)
  const stmts = DB_SCOPES.map((scope) => {
    const group = ident(groupRole(prefix, scope))
    return held.has(scope)
      ? `GRANT ${group} TO ${ident(agentRole)};`
      : `REVOKE ${group} FROM ${ident(agentRole)};`
  })
  await withAdmin(ownerUri, (admin) => admin.unsafe(stmts.join('\n')))
}

/** Drop an agent's login role, transferring any tables it created back to the owner. */
export async function dropAgentRole(ownerUri: string, agentRole: string): Promise<void> {
  await withAdmin(ownerUri, async (admin) => {
    const exists = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${agentRole}`
    if (exists.length === 0) {
      return
    }
    const r = ident(agentRole)
    await admin.unsafe(`REASSIGN OWNED BY ${r} TO CURRENT_USER`)
    await admin.unsafe(`DROP OWNED BY ${r}`)
    await admin.unsafe(`DROP ROLE IF EXISTS ${r}`)
  })
}

/**
 * Drop every role belonging to a database (its scope group roles and agent login
 * roles), identified by the `<dbName>_` prefix. Used when tearing a project down on
 * a shared cluster, where roles outlive the dropped database.
 */
export async function dropProjectRoles(adminUri: string, dbPrefix: string): Promise<void> {
  await withAdmin(adminUri, async (admin) => {
    const rows = await admin<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname ^@ ${`${dbPrefix}_`}
    `
    for (const { rolname } of rows) {
      // Sequential by design: one admin connection, avoid racing role drops.
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP OWNED BY ${ident(rolname)}`)
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP ROLE IF EXISTS ${ident(rolname)}`)
    }
  })
}
