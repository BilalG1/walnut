/**
 * Agent scopes. For the MVP these are all database-related, but the type is
 * intentionally a flat string union (e.g. `db:read`, later `fn:deploy`,
 * `email:send`, `logs:read`) so new capability domains can be added without
 * reshaping the model.
 */
export const DB_SCOPES = ['db:read', 'db:write', 'db:delete', 'db:ddl'] as const

export type DbScope = (typeof DB_SCOPES)[number]

/** Union of every scope the platform understands today. */
export type AgentScope = DbScope

/** Every scope that can currently be granted, in display order. */
export const ALL_SCOPES: readonly AgentScope[] = DB_SCOPES

export const SCOPE_DESCRIPTIONS: Record<AgentScope, string> = {
  'db:read': 'Run read-only queries (SELECT, SHOW, EXPLAIN).',
  'db:write': 'Insert, update and copy rows (INSERT, UPDATE, MERGE, COPY).',
  'db:delete': 'Remove rows (DELETE, TRUNCATE).',
  'db:ddl': 'Change the schema (CREATE, ALTER, DROP, GRANT).',
}

const SCOPE_SET: ReadonlySet<string> = new Set(ALL_SCOPES)

export function isAgentScope(value: string): value is AgentScope {
  return SCOPE_SET.has(value)
}

/**
 * The resource a grant (or scope request) is anchored to. An agent is org-scoped
 * (its tenancy), but a grant binds it to a specific node in the resource tree:
 * the whole `org`, a single `project`, or a `branch` of a project. The union is
 * intentionally open so future nodes slot in without reshaping the grant model.
 */
export const GRANT_RESOURCE_TYPES = ['org', 'project', 'branch'] as const

export type GrantResourceType = (typeof GRANT_RESOURCE_TYPES)[number]

/**
 * Which scopes are grantable at each resource level. `db:*` scopes attach to a
 * database, which only exists at the `project`/`branch` level — never the `org`,
 * which has no database of its own. The `org` level is reserved vocabulary for
 * future, non-database org-wide scopes (e.g. `project:create`, `member:invite`),
 * so it grants nothing today.
 */
export const SCOPES_BY_RESOURCE: Record<GrantResourceType, readonly AgentScope[]> = {
  org: [],
  project: DB_SCOPES,
  branch: DB_SCOPES,
}

export function isScopeValidForResource(resourceType: GrantResourceType, scope: AgentScope): boolean {
  return SCOPES_BY_RESOURCE[resourceType].includes(scope)
}

/**
 * Validate and normalise scopes for a specific resource level: parses them like
 * `parseScopes` (rejecting unknown scopes), then rejects any scope that cannot be
 * granted at `resourceType`. Throws with a clear, machine-readable message so the
 * agent learns exactly which scopes belong at which level.
 */
export function parseScopesForResource(resourceType: GrantResourceType, input: readonly string[]): AgentScope[] {
  const parsed = parseScopes(input)
  const allowed = SCOPES_BY_RESOURCE[resourceType]
  const disallowed = parsed.filter((s) => !allowed.includes(s))
  if (disallowed.length > 0) {
    const allowedText = allowed.length === 0 ? 'none' : allowed.join(', ')
    throw new Error(
      `Scope(s) ${disallowed.join(', ')} cannot be granted at the "${resourceType}" level. ` +
        `Scopes grantable at "${resourceType}": ${allowedText}.`,
    )
  }
  return parsed
}

/**
 * Validate and normalise an arbitrary list of scope strings into a deduplicated,
 * display-ordered list of known scopes. Throws on any unknown scope so callers
 * get a precise error instead of silently dropping input.
 */
export function parseScopes(input: readonly string[]): AgentScope[] {
  const unknown = input.filter((s) => !isAgentScope(s))
  if (unknown.length > 0) {
    throw new Error(`Unknown scope(s): ${unknown.join(', ')}. Valid scopes: ${ALL_SCOPES.join(', ')}.`)
  }
  return ALL_SCOPES.filter((s) => input.includes(s))
}

/** Scopes in `required` that are missing from `held`, in display order. */
export function missingScopes(held: readonly AgentScope[], required: readonly AgentScope[]): AgentScope[] {
  const heldSet = new Set(held)
  return ALL_SCOPES.filter((s) => required.includes(s) && !heldSet.has(s))
}

/** Bit per database scope, so a set of scopes collapses to one canonical integer (a
 * "scope set" identity). Only `db:*` scopes carry a bit — they're the ones backed by a
 * Postgres group role, so the mask is exactly what selects a shared scoped connection.
 * Future non-database scopes (e.g. `fn:deploy`) have no engine role and don't widen it. */
const DB_SCOPE_BIT: Record<DbScope, number> = {
  'db:read': 1,
  'db:write': 2,
  'db:delete': 4,
  'db:ddl': 8,
}

/** Canonical bitmask for the database scopes in `scopes` (non-database scopes ignored). */
export function scopeMask(scopes: readonly AgentScope[]): number {
  const held = new Set<string>(scopes)
  let mask = 0
  for (const s of DB_SCOPES) {
    if (held.has(s)) {
      mask |= DB_SCOPE_BIT[s]
    }
  }
  return mask
}

/**
 * Canonical key for a *set* of database scopes — the unit a shared per-database scoped role
 * (and its connection) is keyed by. Two agents whose effective database scopes match share a
 * role, so this collapses the scope list to one stable string regardless of order/duplicates.
 * `'0'` means "no database access" (no role, no connection).
 */
export function scopeSetKey(scopes: readonly AgentScope[]): string {
  return String(scopeMask(scopes))
}

/** A scope an agent holds, with its optional expiry (`null` = permanent). The unit of
 * a grant that carries time — see `effectiveScopes`. */
export interface ScopeWithExpiry {
  scope: AgentScope
  expiresAt: Date | null
}

/**
 * The scopes that are *currently in force* given each one's expiry — permanent scopes
 * (`expiresAt === null`) and those whose deadline is still in the future — deduplicated
 * and in display order. An expired scope simply isn't returned, so callers (the
 * classifier check, role sync, identity) all see access lapse without any separate
 * revoke step. `now` is injectable for deterministic tests.
 */
export function effectiveScopes(entries: readonly ScopeWithExpiry[], now: Date = new Date()): AgentScope[] {
  const live = new Set<string>()
  for (const e of entries) {
    if (e.expiresAt === null || e.expiresAt.getTime() > now.getTime()) {
      live.add(e.scope)
    }
  }
  return ALL_SCOPES.filter((s) => live.has(s))
}
