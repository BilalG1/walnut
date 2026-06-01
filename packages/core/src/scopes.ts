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
