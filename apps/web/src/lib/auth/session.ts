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
 * Local (self-host) sign-in: mint a session from the built-in offline auth provider.
 * With no email it signs in as the single default local user; pass one to use a distinct
 * (stable) identity. Stores the tokens so the rest of the app is authed identically to
 * any other sign-in.
 */
export async function localLogin(email?: string): Promise<void> {
  const res = await fetch(`${authConfig.apiUrl}/auth/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(email === undefined ? {} : { email }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Local sign-in failed (${res.status}).`)
  }
  const data = (await res.json()) as { accessToken?: unknown; refreshToken?: unknown }
  if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    throw new Error('Local sign-in returned an unexpected response.')
  }
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
}

/** Refresh against the local auth provider's stateless `/auth/local/refresh` endpoint. */
async function refreshLocal(refreshToken: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(`${authConfig.apiUrl}/auth/local/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
  } catch {
    return null
  }
  if (!res.ok) {
    return null
  }
  const data = (await res.json().catch(() => ({}))) as { accessToken?: unknown; refreshToken?: unknown }
  if (typeof data.accessToken !== 'string') {
    return null
  }
  // Guard against a concurrent sign-out / newer refresh (see the Hexclave path below).
  if (getRefreshToken() !== refreshToken) {
    return null
  }
  if (typeof data.refreshToken === 'string') {
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
  } else {
    setAccessToken(data.accessToken)
  }
  return data.accessToken
}

/**
 * Refresh the access token using the stored refresh token. In local auth mode this hits
 * the built-in provider's refresh endpoint; otherwise the Hexclave OAuth token endpoint
 * (the same one the OAuth code exchange uses). Returns the new access token, or null if
 * there's no refresh token or the refresh was rejected. Rotates the refresh token when a
 * new one comes back.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (refreshToken === null) {
    return null
  }
  if (authConfig.localAuth) {
    return refreshLocal(refreshToken)
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: authConfig.projectId,
    client_secret: authConfig.oauthClientSecret,
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
