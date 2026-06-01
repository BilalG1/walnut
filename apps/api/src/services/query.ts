import { classifySql, missingScopes, type QueryResult, runSql, SCOPE_DESCRIPTIONS } from '@walnut/core'
import type { AgentGrant, Project } from '@walnut/db'
import { HttpError } from '../errors.ts'

export interface AgentQueryResult extends QueryResult {
  requiredScopes: string[]
}

/**
 * Execute an agent's SQL against a project database, enforcing the grant's scopes
 * first. A missing scope yields a clear, machine-readable 403 telling the agent
 * exactly what it lacks and how to ask for it — the heart of the agent-first
 * contract.
 */
export async function runAgentQuery(project: Project, grant: AgentGrant, sql: string): Promise<AgentQueryResult> {
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

  const missing = missingScopes(grant.scopes, classification.requiredScopes)
  if (missing.length > 0) {
    throw new HttpError(403, {
      error: 'insufficient_scope',
      message:
        `This query requires scope(s) [${classification.requiredScopes.join(', ')}] but your agent is missing [${missing.join(', ')}]. ` +
        'You can proceed without running it, or ask the user to grant the scope by creating a scope request ' +
        '(POST /agent/v1/scope-requests).',
      requiredScopes: classification.requiredScopes,
      missingScopes: missing,
      grantedScopes: grant.scopes,
      scopeDetails: missing.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
      howToRequest: 'POST /agent/v1/scope-requests with body { "scopes": [...], "reason": "..." }',
    })
  }

  // Run over the grant's own restricted role (defense in depth: the database engine
  // backs up the classifier). Fall back to the owner connection only if the grant
  // somehow has no scoped connection.
  const connectionUri = grant.connectionUri ?? project.connectionUri

  let result: QueryResult
  try {
    result = await runSql(connectionUri, sql)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query failed'
    throw new HttpError(400, { error: 'query_error', message })
  }

  return { ...result, requiredScopes: classification.requiredScopes }
}
