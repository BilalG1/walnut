import { authConfig } from './config.ts'
import { getRefreshToken, setAccessToken, setTokens } from './tokens.ts'

/**
 * Dev-login: trade an email for a real Hexclave session via the API's dev bypass.
 * Stores the returned tokens so every subsequent request is authed identically to a
 * real OAuth sign-in.
 */
export async function devLogin(email: string): Promise<void> {
  const res = await fetch(`${authConfig.apiUrl}/dev/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Dev login failed (${res.status}).`)
  }
  const data = (await res.json()) as { accessToken?: unknown; refreshToken?: unknown }
  if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    throw new Error('Dev login returned an unexpected response.')
  }
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
}

/**
 * Refresh the access token using the stored refresh token (Hexclave OAuth token
 * endpoint, the same one the OAuth code exchange uses). Returns the new access token,
 * or null if there's no refresh token or the refresh was rejected. Rotates the refresh
 * token when Hexclave returns a new one.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (refreshToken === null) {
    return null
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: authConfig.projectId,
    client_secret: authConfig.publishableClientKey,
  })
  let res: Response
  try {
    res = await fetch(`${authConfig.hexclaveApiBaseUrl}/api/v1/auth/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    return null
  }
  if (!res.ok) {
    return null
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown }
  if (typeof data.access_token !== 'string') {
    return null
  }
  // The session may have been signed out (or rotated by a concurrent refresh) while we
  // were in flight. Only apply if OUR refresh token is still the active one — otherwise
  // drop the result so a late refresh can't resurrect a signed-out session or clobber a
  // newer one.
  if (getRefreshToken() !== refreshToken) {
    return null
  }
  if (typeof data.refresh_token === 'string') {
    setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token })
  } else {
    setAccessToken(data.access_token)
  }
  return data.access_token
}
