import { RATE_LIMITS, type RateLimitName } from './limits.ts'

/**
 * In-memory token-bucket rate limiter plus a concurrency gauge — the burst-protection layer of
 * the limits feature. Pure and clock-injectable so the logic is unit-testable without timers; the
 * app holds one instance on its context. Adequate for the single-instance MVP — state is process-
 * local and lost on restart, with the durable resource caps as the backstop. Spanning multiple
 * instances later means swapping this for a shared store (Redis) behind the same interface.
 */

interface Bucket {
  /** Current token count (fractional — refill is continuous). */
  tokens: number
  /** Clock reading (ms) at the last refill. */
  updatedAt: number
}

export interface RateLimitResult {
  /** Whether a token was available and consumed. */
  allowed: boolean
  /** When denied, ms until the next token frees up (0 when allowed). */
  retryAfterMs: number
}

export interface RateLimiter {
  /** Try to consume one token from the `(name, key)` bucket, refilling for elapsed time first. */
  take(name: RateLimitName, key: string): RateLimitResult
  /** Acquire one concurrency slot for `key` (max `limit` in flight). Returns a release callback,
   * or `null` when already at the limit. The callback is idempotent — safe to call in a `finally`. */
  acquire(key: string, limit: number): (() => void) | null
  /** Drop all bucket and in-flight state. For tests between cases. */
  reset(): void
}

/**
 * Build a {@link RateLimiter}. `now` defaults to `Date.now`; pass a fixed/controllable clock in
 * tests to make refill (and thus exhaustion) deterministic.
 */
export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>()
  const inflight = new Map<string, number>()

  function take(name: RateLimitName, key: string): RateLimitResult {
    const budget = RATE_LIMITS[name]
    const id = `${name}:${key}`
    const t = now()
    const bucket = buckets.get(id) ?? { tokens: budget.capacity, updatedAt: t }
    // Continuous refill: add the tokens accrued since the last touch, capped at capacity.
    const elapsedSec = Math.max(0, t - bucket.updatedAt) / 1000
    bucket.tokens = Math.min(budget.capacity, bucket.tokens + elapsedSec * budget.refillPerSec)
    bucket.updatedAt = t
    buckets.set(id, bucket)

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { allowed: true, retryAfterMs: 0 }
    }
    // Time for the deficit to refill to a whole token.
    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / budget.refillPerSec) * 1000)
    return { allowed: false, retryAfterMs }
  }

  function acquire(key: string, limit: number): (() => void) | null {
    const current = inflight.get(key) ?? 0
    if (current >= limit) {
      return null
    }
    inflight.set(key, current + 1)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const n = inflight.get(key) ?? 1
      if (n <= 1) {
        inflight.delete(key)
      } else {
        inflight.set(key, n - 1)
      }
    }
  }

  function reset(): void {
    buckets.clear()
    inflight.clear()
  }

  return { take, acquire, reset }
}
