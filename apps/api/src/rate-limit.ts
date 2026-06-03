import type { RateLimiter, RateLimitName } from '@walnut/core'
import { HttpError } from './errors.ts'

/**
 * Consume one token for `(name, key)`; throw a 429 if the bucket is empty. The body carries
 * `retryAfterMs` (machine-readable) and `onError` mirrors it into a `Retry-After` header. Call
 * this at the start of a handler/service for burst protection — distinct from the 403 resource
 * caps ("you hold too many") in that it means "you're going too fast".
 */
export function enforceRate(limiter: RateLimiter, name: RateLimitName, key: string): void {
  const { allowed, retryAfterMs } = limiter.take(name, key)
  if (!allowed) {
    throw new HttpError(429, {
      error: 'rate_limited',
      message: `Rate limit exceeded for ${name}. Retry in ~${Math.ceil(retryAfterMs / 1000)}s.`,
      limit: name,
      retryAfterMs,
    })
  }
}
