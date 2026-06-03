import { describe, expect, test } from 'bun:test'
import { RATE_LIMITS } from '../src/limits.ts'
import { createRateLimiter } from '../src/rate-limit.ts'

/** A limiter whose clock is a mutable variable, so tests drive refill deterministically. */
function withClock(): { limiter: ReturnType<typeof createRateLimiter>; set: (ms: number) => void } {
  let t = 0
  const limiter = createRateLimiter(() => t)
  return { limiter, set: (ms: number) => (t = ms) }
}

describe('token bucket', () => {
  test('allows a burst up to capacity, then denies', () => {
    const { limiter } = withClock()
    const cap = RATE_LIMITS.agentQuery.capacity
    for (let i = 0; i < cap; i++) {
      expect(limiter.take('agentQuery', 'a').allowed).toBe(true)
    }
    const denied = limiter.take('agentQuery', 'a')
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterMs).toBeGreaterThan(0)
  })

  test('refills continuously over time', () => {
    const { limiter, set } = withClock()
    const cap = RATE_LIMITS.agentQuery.capacity // 40 cap, 20 tokens/sec
    for (let i = 0; i < cap; i++) {
      limiter.take('agentQuery', 'a')
    }
    // Empty now: one token needs 1/20s = 50ms to refill.
    expect(limiter.take('agentQuery', 'a')).toEqual({ allowed: false, retryAfterMs: 50 })
    set(50)
    expect(limiter.take('agentQuery', 'a').allowed).toBe(true) // exactly one token back
    expect(limiter.take('agentQuery', 'a').allowed).toBe(false) // and immediately empty again
  })

  test('refill never exceeds capacity', () => {
    const { limiter, set } = withClock()
    const cap = RATE_LIMITS.provisioningPerUser.capacity // 5
    set(1_000_000_000) // idle a long time — tokens must still cap at `capacity`, not accrue forever
    for (let i = 0; i < cap; i++) {
      expect(limiter.take('provisioningPerUser', 'u').allowed).toBe(true)
    }
    expect(limiter.take('provisioningPerUser', 'u').allowed).toBe(false)
  })

  test('buckets are independent per key and per limit name', () => {
    const { limiter } = withClock()
    for (let i = 0; i < RATE_LIMITS.agentQuery.capacity; i++) {
      limiter.take('agentQuery', 'a')
    }
    expect(limiter.take('agentQuery', 'a').allowed).toBe(false) // 'a' drained
    expect(limiter.take('agentQuery', 'b').allowed).toBe(true) // 'b' untouched
    expect(limiter.take('scopeRequestPerAgent', 'a').allowed).toBe(true) // different limit, own bucket
  })

  test('reset restores all buckets', () => {
    const { limiter } = withClock()
    for (let i = 0; i < RATE_LIMITS.agentQuery.capacity; i++) {
      limiter.take('agentQuery', 'a')
    }
    expect(limiter.take('agentQuery', 'a').allowed).toBe(false)
    limiter.reset()
    expect(limiter.take('agentQuery', 'a').allowed).toBe(true)
  })
})

describe('concurrency gauge', () => {
  test('admits up to the limit, then refuses until a slot frees', () => {
    const { limiter } = withClock()
    const r1 = limiter.acquire('branch:x', 2)
    const r2 = limiter.acquire('branch:x', 2)
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    expect(limiter.acquire('branch:x', 2)).toBeNull() // at limit
    r1?.()
    expect(limiter.acquire('branch:x', 2)).not.toBeNull() // slot freed
  })

  test('release is idempotent', () => {
    const { limiter } = withClock()
    const r1 = limiter.acquire('branch:x', 1)
    r1?.()
    r1?.() // second release must not free a phantom slot
    const r2 = limiter.acquire('branch:x', 1)
    expect(r2).not.toBeNull()
    expect(limiter.acquire('branch:x', 1)).toBeNull() // only the one real slot exists
  })

  test('gauges are independent per key', () => {
    const { limiter } = withClock()
    expect(limiter.acquire('branch:x', 1)).not.toBeNull()
    expect(limiter.acquire('branch:x', 1)).toBeNull()
    expect(limiter.acquire('branch:y', 1)).not.toBeNull() // separate key, own gauge
  })
})
