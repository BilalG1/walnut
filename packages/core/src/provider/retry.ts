/**
 * A small retry-with-backoff helper for transient provider-API failures. Exponential backoff
 * with *full jitter* (delay uniform in `[0, backoff)`) spreads retries so a fleet of callers
 * recovering from the same Neon blip doesn't synchronize into a thundering herd. `sleep` and
 * `random` are injectable so tests run instantly and deterministically (no real timers, no
 * real randomness) — this module never reads the clock or `Math.random` on its own behalf
 * except through these defaults.
 */
export interface RetryOptions {
  /** Retries *after* the first attempt (so total attempts = retries + 1). Default 3. */
  retries?: number
  /** Base backoff in ms; the cap doubles each attempt up to {@link maxDelayMs}. Default 200. */
  baseDelayMs?: number
  /** Ceiling on a single backoff window, in ms. Default 5000. */
  maxDelayMs?: number
  /** Sleep primitive (injected in tests). Default: real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
  /** Uniform [0,1) source for jitter (injected in tests). Default: `Math.random`. */
  random?: () => number
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run `fn`, retrying while `isRetryable(err)` is true and attempts remain. Re-throws the last
 * error once retries are exhausted or the error is non-retryable. `fn` receives the zero-based
 * attempt number.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 200
  const maxDelayMs = options.maxDelayMs ?? 5000
  const sleep = options.sleep ?? realSleep
  const random = options.random ?? Math.random

  for (let attempt = 0; ; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(attempt)
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw err
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoff * random())
    }
  }
}
