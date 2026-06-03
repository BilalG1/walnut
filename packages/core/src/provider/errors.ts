/**
 * Why these exist: provisioning runs against an external provider API (Neon) over the network,
 * so it fails in distinct ways that the caller must treat differently — a throttle or a blip is
 * worth retrying, the *shared account* hitting its own quota is a platform-capacity condition
 * (not the tenant's fault), and a 4xx we caused is a bug. The service layer maps each `reason`
 * to a different HTTP response; the retry layer keys off `retryable`.
 */
export type ProviderErrorReason =
  /** Provider API throttled us (HTTP 429). Transient — retry with backoff. */
  | 'rate_limited'
  /** Provider API 5xx, or the request never completed (network/DNS/timeout). Transient. */
  | 'unavailable'
  /** The shared provider *account* hit its own ceiling (e.g. max projects/branches/compute
   * endpoints across all tenants). Not retryable, and not a per-tenant limit — it's platform
   * capacity, surfaced distinctly from a tenant's resource cap. */
  | 'account_limit'
  /** A 4xx we caused (bad input/auth). Not retryable. */
  | 'bad_request'
  /** Unclassified non-2xx. Not retryable by default. */
  | 'unknown'

/** An error from a {@link DatabaseProvider} operation, classified so callers can react without
 * string-matching. Carries the upstream HTTP `status` when there was one. */
export class ProviderError extends Error {
  readonly reason: ProviderErrorReason
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, opts: { reason: ProviderErrorReason; status?: number; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = 'ProviderError'
    this.reason = opts.reason
    this.status = opts.status
    this.retryable = opts.reason === 'rate_limited' || opts.reason === 'unavailable'
  }
}

/** Map an upstream HTTP status (+ body text) to a classified {@link ProviderError}. A 429 is a
 * throttle, 5xx is unavailability, and a 4xx whose body reads like a quota message is the shared
 * account hitting its own ceiling (Neon returns these as 403/422/400 with a "limit/quota/maximum"
 * message rather than a stable machine code). */
export function classifyProviderStatus(message: string, status: number, bodyText: string): ProviderError {
  if (status === 429) {
    return new ProviderError(message, { reason: 'rate_limited', status })
  }
  if (status >= 500) {
    return new ProviderError(message, { reason: 'unavailable', status })
  }
  const looksLikeQuota = /limit|quota|exceed|maximum number|reached the maximum/i.test(bodyText)
  if ((status === 403 || status === 422 || status === 400) && looksLikeQuota) {
    return new ProviderError(message, { reason: 'account_limit', status })
  }
  if (status >= 400) {
    return new ProviderError(message, { reason: 'bad_request', status })
  }
  return new ProviderError(message, { reason: 'unknown', status })
}
