import { treaty } from '@elysiajs/eden'
import type { App } from '@walnut/api/app'
import { authConfig } from './lib/auth/config.ts'
import { refreshAccessToken } from './lib/auth/session.ts'
import { clearTokens, getAccessToken, getRefreshToken } from './lib/auth/tokens.ts'

const API_URL = authConfig.apiUrl

// Collapse concurrent refreshes: many in-flight requests can 401 at once, but they
// should share a single refresh rather than stampede the token endpoint.
let refreshInFlight: Promise<string | null> | null = null
function refreshOnce(): Promise<string | null> {
  refreshInFlight ??= refreshAccessToken().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

/**
 * Fetch wrapper that attaches the current access token and, on a 401, transparently
 * refreshes once and retries. If the refresh fails, it clears the session (which the
 * auth context observes and routes back to the sign-in screen).
 *
 * Contract: the API signals auth failure with 401 (see the backend's `unauthorized`
 * helper) — this is the only status that triggers a refresh. The single retry reuses
 * `init.body`, which is safe because treaty serializes bodies to strings (replayable);
 * revisit if file/stream upload routes are added.
 */
async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = getAccessToken()
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`)
  }
  const res = await fetch(input, { ...init, headers })
  if (res.status !== 401 || getRefreshToken() === null) {
    return res
  }
  const refreshed = await refreshOnce()
  if (refreshed === null) {
    clearTokens()
    return res
  }
  headers.set('authorization', `Bearer ${refreshed}`)
  return fetch(input, { ...init, headers })
}

/** Type-safe RPC client generated from the Elysia backend's types. The fetcher is a
 * plain wrapper, so cast past `typeof fetch`'s static members (e.g. `preconnect`). */
export const api = treaty<App>(API_URL, { fetcher: authFetch as typeof fetch })

export { API_URL }
