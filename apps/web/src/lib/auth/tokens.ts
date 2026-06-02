/**
 * Token store: the single source of truth for the current session's access/refresh
 * tokens. Backed by localStorage (lightweight; the trade-off vs httpOnly cookies is
 * XSS exposure) with an in-memory cache. The treaty fetcher reads from here on every
 * request; the auth context subscribes to react to sign-in / sign-out.
 */
const ACCESS_KEY = 'walnut.accessToken'
const REFRESH_KEY = 'walnut.refreshToken'

export interface Tokens {
  accessToken: string
  refreshToken: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let cache: Tokens | null | undefined

function read(): Tokens | null {
  if (cache !== undefined) {
    return cache
  }
  try {
    const accessToken = localStorage.getItem(ACCESS_KEY)
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    cache = accessToken !== null && refreshToken !== null ? { accessToken, refreshToken } : null
  } catch {
    cache = null
  }
  return cache
}

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getTokens(): Tokens | null {
  return read()
}

export function getAccessToken(): string | null {
  return read()?.accessToken ?? null
}

export function getRefreshToken(): string | null {
  return read()?.refreshToken ?? null
}

/** Persist a new session and notify subscribers (a sign-in / identity change). */
export function setTokens(tokens: Tokens): void {
  cache = tokens
  try {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken)
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken)
  } catch {
    // Storage unavailable (private mode); the in-memory cache still works for this tab.
  }
  emit()
}

/** Rotate just the access token after a refresh, keeping the refresh token. Does NOT
 * notify subscribers — the user's identity is unchanged, so the UI shouldn't churn. */
export function setAccessToken(accessToken: string): void {
  const current = read()
  if (current === null) {
    return
  }
  cache = { ...current, accessToken }
  try {
    localStorage.setItem(ACCESS_KEY, accessToken)
  } catch {
    // ignore
  }
}

/** Clear the session (sign-out / failed refresh) and notify subscribers. */
export function clearTokens(): void {
  cache = null
  try {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    // ignore
  }
  emit()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Keep tabs in sync: a `storage` event fires only in OTHER tabs, so when one tab signs
// in/out, the rest drop their cache and re-render (e.g. route back to sign-in after a
// remote sign-out). Same-tab writes don't fire this, so it never double-emits locally.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === ACCESS_KEY || event.key === REFRESH_KEY || event.key === null) {
      cache = undefined
      emit()
    }
  })
}
