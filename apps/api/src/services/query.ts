import {
  classifySql,
  effectiveScopes,
  missingScopes,
  type QueryResult,
  runSql,
  sameScopeSet,
  SCOPE_DESCRIPTIONS,
} from '@walnut/core'
import type { Project } from '@walnut/db'
import type { AppContext } from '../context.ts'
import { HttpError } from '../errors.ts'
import { ensureGrantSynced, type GrantWithScopes } from './agents.ts'

export interface AgentQueryResult extends QueryResult {
  requiredScopes: string[]
}

/**
 * Execute an agent's SQL against a project database, enforcing the agent's scopes
 * first. A missing scope yields a clear, machine-readable 403 telling the agent
 * exactly what it lacks and how to ask for it — the heart of the agent-first
 * contract.
 *
 * Scopes come from the metadata DB (the source of truth), expiry-filtered to those still
 * in force. The agent's Postgres role is reconciled to those effective scopes
 * ({@link ensureGrantSynced}) and the query runs over its restricted connection — never the
 * project owner connection — so the engine backs up the classifier (defense in depth). The
 * reconcile also runs on the *denied* path whenever a provisioned role's memberships have
 * drifted (e.g. a scope lapsed), so engine revocation never trails the source of truth.
 */
export async function runAgentQuery(
  ctx: AppContext,
  project: Project,
  grant: GrantWithScopes | null,
  sql: string,
): Promise<AgentQueryResult> {
  if (project.status !== 'active' || project.connectionUri === null) {
    throw new HttpError(409, {
      error: 'project_not_ready',
      message: `Project is "${project.status}"; its database is not ready for queries yet.`,
    })
  }

  const classification = await classifySql(sql)
  if (classification.empty) {
    throw new HttpError(400, { error: 'empty_query', message: 'SQL statement is empty.' })
  }

  const now = new Date()
  const granted = grant === null ? [] : effectiveScopes(grant.scopes, now)
  const missing = missingScopes(granted, classification.requiredScopes)
  if (missing.length > 0) {
    // Denied — but if a provisioned role still carries memberships that have since lapsed,
    // revoke them now rather than deferring to the next authorised query. Bounded: this only
    // does role DDL when the synced snapshot has actually drifted (e.g. a scope just
    // expired), after which the snapshot matches and repeat denials are a no-op.
    if (grant !== null && grant.dbRole !== null && !sameScopeSet(grant.syncedScopes, granted)) {
      await ensureGrantSynced(ctx, grant, project.connectionUri, now)
    }
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

  // Authorised by the metadata DB. `grant` is necessarily non-null here (an empty grant
  // yields no effective scopes, which can't satisfy a real statement's required scopes).
  // Reconcile the engine to the effective scopes (provisioning the role lazily on first use).
  if (grant === null) {
    throw new HttpError(500, { error: 'internal_error', message: 'Authorised query unexpectedly has no grant.' })
  }
  const { connectionUri } = await ensureGrantSynced(ctx, grant, project.connectionUri, now)
  if (connectionUri === null) {
    // Fail closed: a scoped query must never fall back to the owner (superuser) connection.
    throw new HttpError(500, { error: 'internal_error', message: 'No scoped connection provisioned for grant.' })
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
