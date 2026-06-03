import { describe, expect, test } from 'bun:test'
import { createNeonProvider } from '../src/provider/neon.ts'
import { ProviderError, classifyProviderStatus } from '../src/provider/errors.ts'
import { withRetry } from '../src/provider/retry.ts'

// Instant, deterministic retries: no real timers (sleep is a no-op) and no real randomness
// (jitter factor pinned to 0), so tests assert call counts without waiting on backoff.
const FAST_RETRY = { retries: 3, baseDelayMs: 1, sleep: async () => {}, random: () => 0 }

interface RecordedCall {
  url: string
  method: string
  body: unknown
}

type Outcome = { status: number; body?: unknown } | { networkError: true }

/** A fake `fetch` that plays back scripted outcomes in order (repeating the last once exhausted,
 * so "always fails" is a single entry) and records every call for assertions. */
function fakeFetch(outcomes: Outcome[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  let i = 0
  const fn = (async (url: string, init?: RequestInit) => {
    const bodyRaw = init?.body
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : undefined,
    })
    const outcome = outcomes[Math.min(i, outcomes.length - 1)]
    i++
    if (outcome === undefined) {
      throw new Error('fakeFetch: no outcome configured')
    }
    if ('networkError' in outcome) {
      throw new TypeError('network down')
    }
    const payload = outcome.body === undefined ? '' : JSON.stringify(outcome.body)
    return new Response(payload, { status: outcome.status })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const PROJECT_OK = {
  project: { id: 'proj-1', region_id: 'aws-us-east-1' },
  branch: { id: 'br-main' },
  connection_uris: [{ connection_uri: 'postgres://owner@host/db' }],
}
const BRANCH_OK = {
  branch: { id: 'br-2' },
  connection_uris: [{ connection_uri: 'postgres://owner@host/db2' }],
}

describe('classifyProviderStatus', () => {
  test('429 is a retryable rate-limit', () => {
    const err = classifyProviderStatus('m', 429, '')
    expect(err.reason).toBe('rate_limited')
    expect(err.retryable).toBe(true)
  })

  test('5xx is retryable unavailability', () => {
    expect(classifyProviderStatus('m', 503, 'oops').retryable).toBe(true)
    expect(classifyProviderStatus('m', 500, '').reason).toBe('unavailable')
  })

  test('a 4xx quota message is a non-retryable account_limit', () => {
    const err = classifyProviderStatus('m', 422, 'You have reached the maximum number of projects')
    expect(err.reason).toBe('account_limit')
    expect(err.retryable).toBe(false)
  })

  test('a plain 4xx is a non-retryable bad_request', () => {
    const err = classifyProviderStatus('m', 400, 'invalid name')
    expect(err.reason).toBe('bad_request')
    expect(err.retryable).toBe(false)
  })
})

describe('withRetry', () => {
  test('retries a retryable error then succeeds', async () => {
    let n = 0
    const result = await withRetry(
      async () => {
        n++
        if (n < 3) throw new ProviderError('x', { reason: 'unavailable' })
        return 'ok'
      },
      (e) => e instanceof ProviderError && e.retryable,
      FAST_RETRY,
    )
    expect(result).toBe('ok')
    expect(n).toBe(3)
  })

  test('does not retry a non-retryable error', async () => {
    let n = 0
    await expect(
      withRetry(
        async () => {
          n++
          throw new ProviderError('x', { reason: 'bad_request' })
        },
        (e) => e instanceof ProviderError && e.retryable,
        FAST_RETRY,
      ),
    ).rejects.toBeInstanceOf(ProviderError)
    expect(n).toBe(1)
  })

  test('gives up after exhausting retries', async () => {
    let n = 0
    await expect(
      withRetry(
        async () => {
          n++
          throw new ProviderError('x', { reason: 'unavailable' })
        },
        () => true,
        FAST_RETRY,
      ),
    ).rejects.toBeInstanceOf(ProviderError)
    expect(n).toBe(4) // 1 attempt + 3 retries
  })
})

describe('createNeonProvider', () => {
  test('provisionProject parses the project + default branch', async () => {
    const { fetch, calls } = fakeFetch([{ status: 201, body: PROJECT_OK }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    const result = await provider.provisionProject({ name: 'analytics' })
    expect(result.providerProjectId).toBe('proj-1')
    expect(result.defaultBranch.providerBranchId).toBe('br-main')
    expect(result.defaultBranch.connectionUri).toBe('postgres://owner@host/db')
    expect(result.defaultBranch.region).toBe('aws-us-east-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toEqual({ project: { name: 'analytics' } })
  })

  test('createBranch sends parent_id when branching from a parent', async () => {
    const { fetch, calls } = fakeFetch([{ status: 201, body: BRANCH_OK }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    const result = await provider.createBranch({
      providerProjectId: 'proj-1',
      name: 'feature-x',
      fromProviderBranchId: 'br-main',
    })
    expect(result.providerBranchId).toBe('br-2')
    const body = calls[0]?.body as { branch: { name: string; parent_id?: string } }
    expect(body.branch.parent_id).toBe('br-main')
  })

  test('retries a 429 then succeeds', async () => {
    const { fetch, calls } = fakeFetch([{ status: 429 }, { status: 429 }, { status: 201, body: PROJECT_OK }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    const result = await provider.provisionProject({ name: 'p' })
    expect(result.providerProjectId).toBe('proj-1')
    expect(calls).toHaveLength(3)
  })

  test('retries a dropped (network-error) request', async () => {
    const { fetch, calls } = fakeFetch([{ networkError: true }, { status: 201, body: PROJECT_OK }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    await provider.provisionProject({ name: 'p' })
    expect(calls).toHaveLength(2)
  })

  test('gives up on a persistent 503 with reason "unavailable"', async () => {
    const { fetch, calls } = fakeFetch([{ status: 503, body: { message: 'down' } }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    await expect(provider.provisionProject({ name: 'p' })).rejects.toMatchObject({
      name: 'ProviderError',
      reason: 'unavailable',
    })
    expect(calls).toHaveLength(4)
  })

  test('does not retry an account-limit error', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 422, body: { message: 'You have reached the maximum number of projects' } },
    ])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    await expect(provider.provisionProject({ name: 'p' })).rejects.toMatchObject({ reason: 'account_limit' })
    expect(calls).toHaveLength(1)
  })

  test('destroyBranch treats 404 as success', async () => {
    const { fetch } = fakeFetch([{ status: 404 }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    await expect(
      provider.destroyBranch({ providerProjectId: 'proj-1', providerBranchId: 'br-2' }),
    ).resolves.toBeUndefined()
  })

  test('destroyProject retries a 500 then gives up', async () => {
    const { fetch, calls } = fakeFetch([{ status: 500, body: { message: 'boom' } }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    await expect(provider.destroyProject('proj-1')).rejects.toBeInstanceOf(ProviderError)
    expect(calls).toHaveLength(4)
  })

  test('destroyProject succeeds on 200', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200 }])
    const provider = createNeonProvider('key', { fetch, retry: FAST_RETRY })
    await expect(provider.destroyProject('proj-1')).resolves.toBeUndefined()
    expect(calls[0]?.method).toBe('DELETE')
  })
})
