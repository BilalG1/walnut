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
