import * as Sentry from '@sentry/bun'

let initialized = false

/**
 * Error reporting via Sentry. Off unless `SENTRY_DSN` is set, so local dev, tests, and any
 * deploy that hasn't configured a DSN run without it and never phone home. `captureException`
 * is a safe no-op until `initSentry` runs, so call sites don't have to guard.
 *
 * Tracing is off by default (error reporting is the launch need); set
 * `SENTRY_TRACES_SAMPLE_RATE` to opt in.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (dsn === undefined || dsn === '') {
    return false
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
  })
  initialized = true
  return true
}

/** Report an exception (with optional structured context) when Sentry is configured; a safe
 * no-op otherwise. Use at seams where an error is otherwise swallowed or transformed and would
 * be lost — e.g. a best-effort cleanup that failed, or the catch-all 500 handler. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    return
  }
  Sentry.captureException(error, context === undefined ? undefined : { extra: context })
}

/** Whether Sentry is active — for a one-line startup log. */
export function isSentryEnabled(): boolean {
  return initialized
}
