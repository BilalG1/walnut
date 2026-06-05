import { type AgentScope, type LimitExceededInfo, missingScopes, SCOPE_DESCRIPTIONS } from '@walnut/core'

export interface HttpErrorBody {
  error: string
  message: string
  [key: string]: unknown
}

/** An error carrying an HTTP status and a JSON body; mapped to a response in `onError`. */
export class HttpError extends Error {
  readonly status: number
  readonly body: HttpErrorBody

  constructor(status: number, body: HttpErrorBody) {
    super(body.message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export function notFound(resource: string): HttpError {
  return new HttpError(404, { error: 'not_found', message: `${resource} not found.` })
}

export function unauthorized(message: string): HttpError {
  return new HttpError(401, { error: 'unauthorized', message })
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, { error: 'bad_request', message })
}

/** A resource cap was hit (e.g. too many branches for a project). 403 with a
 * machine-readable {@link LimitExceededInfo} body (`limit`/`max`/`scope`) so an agent or
 * the dashboard can explain exactly which ceiling was reached. Distinct from a 429 rate
 * limit: this is "you hold too many", not "you're going too fast". */
export function limitExceeded(message: string, info: LimitExceededInfo): HttpError {
  return new HttpError(403, { error: 'limit_exceeded', message, ...info })
}

/**
 * An agent lacks a scope an action requires. 403 with the machine-readable contract an agent
 * branches on: `requiredScopes`/`missingScopes`/`grantedScopes`, a per-missing-scope
 * `scopeDetails`, and `howToRequest` pointing at the scope-request endpoint. `message` is the
 * human-readable lead-in (each caller phrases its own action, e.g. "This query…" vs "Creating a
 * branch…"); the structured fields are identical so a client never has to parse prose.
 */
export function insufficientScope(
  message: string,
  requiredScopes: readonly AgentScope[],
  grantedScopes: readonly AgentScope[],
): HttpError {
  const missing = missingScopes(grantedScopes, requiredScopes)
  return new HttpError(403, {
    error: 'insufficient_scope',
    message,
    requiredScopes: [...requiredScopes],
    missingScopes: missing,
    grantedScopes: [...grantedScopes],
    scopeDetails: missing.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
    howToRequest: 'POST /agent/v1/scope-requests with body { "scopes": [...], "reason": "..." }',
  })
}

/** The database-provider *account* (the one shared Neon account) hit its own quota — a
 * platform-capacity condition the tenant can't fix by holding fewer resources. 503, distinct
 * from the per-org `limit_exceeded` (403): this is "the platform is full", not "you are". */
export function providerCapacity(message: string): HttpError {
  return new HttpError(503, { error: 'provider_capacity', message })
}
