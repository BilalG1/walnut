import {
  type AgentScope,
  classifySql,
  effectiveScopes,
  missingScopes,
  type QueryResult,
  runSql,
  SCOPE_DESCRIPTIONS,
  type ScopeWithExpiry,
} from '@walnut/core'
import type { Branch } from '@walnut/db'
import type { AppContext } from '../context.ts'
import { HttpError } from '../errors.ts'
import { connectionForScopes } from './agents.ts'

export interface AgentQueryResult extends QueryResult {
  requiredScopes: string[]
}

/**
 * Execute an agent's SQL against a project database, enforcing the agent's scopes
 * first. A missing scope yields a clear, machine-readable 403 telling the agent
 * exactly what it lacks and how to ask for it — the heart of the agent-first
 * contract.
 *
 * Scopes come from the metadata DB (the source of truth), expiry-filtered to those still in
 * force. The query then runs over the database's *shared* scoped connection for that exact
 * scope set ({@link connectionForScopes}) — never the project owner connection — so the engine
 * backs up the classifier (defense in depth). When a scope lapses, the agent's effective set
 * simply collapses to a smaller one and a different (lesser) connection is selected; there is
 * no per-agent role to revoke, so engine access can never trail the source of truth.
 */
export async function runAgentQuery(
  ctx: AppContext,
  branch: Branch,
  scopeRows: readonly ScopeWithExpiry[],
  sql: string,
): Promise<AgentQueryResult> {
  if (branch.status !== 'active' || branch.connectionUri === null) {
    throw new HttpError(409, {
      error: 'branch_not_ready',
      message: `Branch "${branch.name}" is "${branch.status}"; its database is not ready for queries yet.`,
    })
  }

  const classification = await classifySql(sql)
  if (classification.empty) {
    throw new HttpError(400, { error: 'empty_query', message: 'SQL statement is empty.' })
  }

  const now = new Date()
  // Effective scopes = the union over the agent's grant chain for this branch, expiry-filtered.
  const granted = effectiveScopes(scopeRows, now)
  const missing = missingScopes(granted, classification.requiredScopes)
  if (missing.length > 0) {
    throw new HttpError(403, {
      error: 'insufficient_scope',
      message:
        `This query requires scope(s) [${classification.requiredScopes.join(', ')}] but your agent is missing [${missing.join(', ')}]. ` +
        'You can proceed without running it, or ask the user to grant the scope by creating a scope request ' +
        '(POST /agent/v1/scope-requests).',
      requiredScopes: classification.requiredScopes,
      missingScopes: missing,
      grantedScopes: granted,
      scopeDetails: missing.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
      howToRequest: 'POST /agent/v1/scope-requests with body { "scopes": [...], "reason": "..." }',
    })
  }

  // Authorised by the metadata DB. Run over the shared scoped connection for the effective
  // scope set on this branch, provisioning that role lazily on first use.
  const connectionUri = await connectionForScopes(ctx, branch, granted)
  if (connectionUri === null) {
    // Fail closed: a scoped query must never fall back to the owner (superuser) connection.
    throw new HttpError(500, { error: 'internal_error', message: 'No scoped connection provisioned for query.' })
  }

  let result: QueryResult
  try {
    result = await runSql(connectionUri, sql)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query failed'
    // Carry the classified scopes so the activity log records them on the error event too.
    throw new HttpError(400, { error: 'query_error', message, requiredScopes: classification.requiredScopes })
  }

  return { ...result, requiredScopes: classification.requiredScopes }
}

/** The only scope the dashboard data viewer is allowed to exercise. */
const VIEWER_SCOPES: readonly AgentScope[] = ['db:read']

/**
 * Run a parameterized, **read-only** query for the dashboard data viewer over a branch's owner
 * connection. The same SQL classifier that guards agents gates this to `db:read`, so the viewer
 * (and its raw-query escape hatch) can never mutate data even though it runs as the owner. This
 * backs `POST /api/projects/:id/sql`, which the `@walnut/db-viewer` Postgres adapter targets
 * from the browser.
 */
export async function runReadOnlyQuery(branch: Branch, sql: string, params: unknown[]): Promise<QueryResult> {
  if (branch.status !== 'active' || branch.connectionUri === null) {
    throw new HttpError(409, {
      error: 'branch_not_ready',
      message: `Branch "${branch.name}" is "${branch.status}"; its database is not ready for queries yet.`,
    })
  }

  const classification = await classifySql(sql)
  if (classification.empty) {
    throw new HttpError(400, { error: 'empty_query', message: 'SQL statement is empty.' })
  }

  const missing = missingScopes(VIEWER_SCOPES, classification.requiredScopes)
  if (missing.length > 0) {
    throw new HttpError(403, {
      error: 'read_only',
      message: `The data viewer is read-only; this statement needs [${missing.join(', ')}]. Only db:read queries are allowed here.`,
      requiredScopes: classification.requiredScopes,
    })
  }

  try {
    // readOnly is the engine-level backstop behind the classifier: the connection runs with
    // default_transaction_read_only, so even a side-effecting function the classifier waved
    // through as db:read (e.g. nextval()) is refused.
    return await runSql(branch.connectionUri, sql, params, { readOnly: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query failed'
    throw new HttpError(400, { error: 'query_error', message })
  }
}
