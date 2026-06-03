import * as Sentry from '@sentry/bun'

let initialized = false

/**
 * Optional crash reporting for the CLI. Off unless `WALNUT_SENTRY_DSN` is set (a CLI-specific
 * var, so a user's server `SENTRY_DSN` never silently routes CLI crashes), so the default
 * experience phones nothing home. `captureException`/`flush` are safe no-ops until configured.
 */
export function initSentry(): boolean {
  const dsn = process.env.WALNUT_SENTRY_DSN?.trim()
  if (dsn === undefined || dsn === '') {
    return false
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
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

/** Flush pending events before the process exits — a short-lived CLI would otherwise drop them.
 * Best-effort and bounded so a slow/unreachable Sentry can't hang the command. */
export async function flush(timeoutMs = 2000): Promise<void> {
  if (!initialized) {
    return
  }
  try {
    await Sentry.flush(timeoutMs)
  } catch {
    // Reporting must never change the CLI's outcome.
  }
}
