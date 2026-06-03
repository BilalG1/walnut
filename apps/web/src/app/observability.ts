import * as Sentry from '@sentry/react'

let initialized = false

/**
 * Browser error reporting via Sentry. Off unless `VITE_SENTRY_DSN` is set at build time, so
 * dev builds and any deploy that hasn't configured a DSN ship nothing. `captureException` is a
 * safe no-op until `initSentry` runs. Error reporting only — tracing/replay are left off to keep
 * the bundle and traffic minimal for the MVP.
 */
export function initSentry(): boolean {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
  if (dsn === undefined || dsn === '') {
    return false
  }
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
  })
  initialized = true
  return true
}

/** Report an exception (with optional context) when configured; a safe no-op otherwise. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    return
  }
  Sentry.captureException(error, context === undefined ? undefined : { extra: context })
}

export { ErrorBoundary } from '@sentry/react'
