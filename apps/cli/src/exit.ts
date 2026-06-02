/**
 * Exit codes are the CLI's machine contract. The whole point of an agent-only CLI
 * is that the caller branches on the exit code without parsing stdout — most
 * importantly, SCOPE (4) lets an agent do "query → got 4 → request scope → retry"
 * deterministically. stderr always carries a JSON `{ error, message, ... }` with the
 * specifics (the API's `error` code, missing scopes, etc.).
 */
export const EXIT = {
  /** Success. Result JSON is on stdout. */
  OK: 0,
  /** Unexpected/internal failure (5xx, or a bug in the CLI). */
  UNEXPECTED: 1,
  /** Local usage error: bad arguments, unknown command, or missing config. Never hit the network. */
  USAGE: 2,
  /** Authentication problem. stderr's `error` says which: `not_logged_in` (no stored
   * credentials — ask the user to run `walnut login`) or `unauthorized` (the key was
   * rejected, HTTP 401 — the user needs to issue a fresh key). */
  AUTH: 3,
  /** Insufficient scope (HTTP 403). stderr lists `missingScopes` and how to request them. */
  SCOPE: 4,
  /** The request was rejected by the API (other 4xx: bad input, conflict, not found). */
  REJECTED: 5,
  /** The API could not be reached (connection refused, DNS, timeout). */
  NETWORK: 7,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/** Map an HTTP status from the agent API to an exit code. */
export function httpStatusToExit(status: number): ExitCode {
  if (status >= 200 && status < 300) return EXIT.OK
  if (status === 401) return EXIT.AUTH
  if (status === 403) return EXIT.SCOPE
  if (status >= 500) return EXIT.UNEXPECTED
  if (status >= 400) return EXIT.REJECTED
  return EXIT.UNEXPECTED
}
