import { treaty } from '@elysiajs/eden'
import type { App } from '@walnut/api/app'
import { EXIT, httpStatusToExit } from './exit.ts'
import { fail, formatJson, ok, type CliResult } from './output.ts'

export type ApiClient = ReturnType<typeof treaty<App>>

/** A type-safe client over the agent API, with the bearer key applied to every call. */
export function makeClient(apiUrl: string, apiKey: string): ApiClient {
  return treaty<App>(apiUrl, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
}

/** The shape every treaty call resolves to (narrowed to what we read). Treaty types
 * `error.status` as `unknown`, so we coerce via `statusOf`. */
export interface TreatyResult {
  data: unknown
  error: { status?: unknown; value: unknown } | null
  status?: number
}

/** The HTTP status of a treaty result, or 0 if the call never reached the server. */
export function statusOf(res: TreatyResult): number {
  if (typeof res.status === 'number') return res.status
  if (typeof res.error?.status === 'number') return res.error.status
  return 0
}

function isErrorBody(value: unknown): value is { error: string; message: string } {
  return typeof value === 'object' && value !== null && 'error' in value && 'message' in value
}

/** Turn a treaty result into a CliResult: success → JSON on stdout; otherwise map the
 * HTTP status to an exit code and pass the API's machine-readable error body to stderr
 * verbatim (so `missingScopes`, `howToRequest`, etc. survive). */
export function respond(res: TreatyResult, pretty: boolean): CliResult {
  const status = statusOf(res)
  if (status === 0) {
    return fail(EXIT.NETWORK, 'network', 'Could not reach the API.', pretty)
  }
  const code = httpStatusToExit(status)
  if (code === EXIT.OK && res.data !== null && res.data !== undefined) {
    return ok(res.data, pretty)
  }
  const body = res.error?.value
  if (isErrorBody(body)) {
    return { stdout: '', stderr: formatJson(body, pretty), code }
  }
  return fail(code, 'api_error', `Request failed with status ${status}.`, pretty)
}

/** Normalize a thrown fetch/connection error into a NETWORK failure. */
export function networkError(err: unknown, pretty: boolean): CliResult {
  const message = err instanceof Error ? err.message : 'Could not reach the API.'
  return fail(EXIT.NETWORK, 'network', message, pretty)
}
