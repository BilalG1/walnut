import type { LimitExceededInfo } from '@walnut/core'

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

/** The database-provider *account* (the one shared Neon account) hit its own quota — a
 * platform-capacity condition the tenant can't fix by holding fewer resources. 503, distinct
 * from the per-org `limit_exceeded` (403): this is "the platform is full", not "you are". */
export function providerCapacity(message: string): HttpError {
  return new HttpError(503, { error: 'provider_capacity', message })
}
