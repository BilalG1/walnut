import { EXIT, type ExitCode } from './exit.ts'

/** The result of a CLI invocation. `index.ts` is the only place that touches the
 * real process; everything else returns one of these so it stays testable. */
export interface CliResult {
  stdout: string
  stderr: string
  code: ExitCode
}

/** Serialize a value as JSON. Compact by default (agents pay per token); `--pretty`
 * for human debugging. */
export function formatJson(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, null, pretty ? 2 : 0)
}

/** A successful result: JSON payload on stdout, nothing on stderr. */
export function ok(value: unknown, pretty: boolean): CliResult {
  return { stdout: formatJson(value, pretty), stderr: '', code: EXIT.OK }
}

/** A failure: a structured `{ error, message, ... }` on stderr, nothing on stdout. */
export function fail(
  code: ExitCode,
  error: string,
  message: string,
  pretty: boolean,
  extra?: Record<string, unknown>,
): CliResult {
  return { stdout: '', stderr: formatJson({ error, message, ...extra }, pretty), code }
}
