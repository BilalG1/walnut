import { authConfig } from './config.ts'
import { computeCodeChallenge, generateCodeVerifier, generateState } from './pkce.ts'
import { setTokens } from './tokens.ts'

/** The OAuth providers we expose today. */
export type OAuthProvider = 'google' | 'github'

const STORAGE_PREFIX = 'walnut.oauth.'
export const OAUTH_CALLBACK_PATH = '/oauth-callback'

interface PendingOAuth {
  verifier: string
  redirectUri: string
}

function redirectUri(): string {
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`
}

/** Drop verifiers from abandoned flows — sessionStorage has no TTL, so prune explicitly. */
function pruneOAuthState(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(STORAGE_PREFIX)) {
      sessionStorage.removeItem(key)
    }
  }
}

/** True when the current page is the OAuth redirect target. */
export function isOAuthCallback(): boolean {
  return window.location.pathname === OAUTH_CALLBACK_PATH
}

/** Build the Hexclave authorize URL (with `hexclave_response_mode=json`) for a flow. */
export function buildAuthorizeUrl(opts: {
  provider: OAuthProvider
  state: string
  codeChallenge: string
  redirectUri: string
}): string {
  const url = new URL(`${authConfig.hexclaveApiBaseUrl}/api/v1/auth/oauth/authorize/${opts.provider}`)
  const p = url.searchParams
  p.set('client_id', authConfig.projectId)
  p.set('client_secret', authConfig.publishableClientKey)
  p.set('redirect_uri', opts.redirectUri)
  p.set('scope', 'legacy')
  p.set('state', opts.state)
  p.set('grant_type', 'authorization_code')
  p.set('code_challenge', opts.codeChallenge)
  p.set('code_challenge_method', 'S256')
  p.set('response_type', 'code')
  p.set('type', 'authenticate')
  p.set('error_redirect_url', opts.redirectUri)
  p.set('hexclave_response_mode', 'json')
  return url.toString()
}

/**
 * Start an OAuth sign-in: generate PKCE + state, stash the verifier keyed by state,
 * ask Hexclave for the provider redirect location, and navigate there. The browser
 * returns to {@link OAUTH_CALLBACK_PATH} where {@link completeOAuthSignIn} finishes it.
 */
export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  pruneOAuthState() // clear any leftovers from earlier abandoned flows
  const verifier = generateCodeVerifier()
  const state = generateState()
  const codeChallenge = await computeCodeChallenge(verifier)
  const uri = redirectUri()

  const storageKey = STORAGE_PREFIX + state
  const pending: PendingOAuth = { verifier, redirectUri: uri }
  sessionStorage.setItem(storageKey, JSON.stringify(pending))

  const authorizeUrl = buildAuthorizeUrl({ provider, state, codeChallenge, redirectUri: uri })
  let res: Response
  try {
    res = await fetch(authorizeUrl, { method: 'GET' })
  } catch (err) {
    sessionStorage.removeItem(storageKey) // don't strand this flow's verifier
    throw err
  }
  if (!res.ok) {
    sessionStorage.removeItem(storageKey)
    throw new Error(`Could not start sign-in (${res.status}).`)
  }
  const body = (await res.json().catch(() => ({}))) as { location?: unknown }
  if (typeof body.location !== 'string') {
    sessionStorage.removeItem(storageKey)
    throw new Error('Sign-in did not return a redirect location.')
  }
  window.location.assign(body.location)
}

function cleanCallbackUrl(): void {
  window.history.replaceState(null, '', `${window.location.origin}/`)
}

/**
 * Finish an OAuth sign-in on the callback page: validate state, exchange the code (with
 * the stored PKCE verifier) for tokens, and store them. Cleans the code/state out of the
 * URL. Throws on a provider error, a missing/forged state, or a failed exchange.
 */
export async function completeOAuthSignIn(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  // Scrub code/state/error from the URL immediately — before any async work — so the
  // single-use code never lingers in the address bar, history, or a Referer header.
  cleanCallbackUrl()

  const errorCode = params.get('error')
  if (errorCode !== null) {
    throw new Error(params.get('error_description') ?? `Sign-in failed: ${errorCode}`)
  }

  const code = params.get('code')
  const state = params.get('state')
  if (code === null || state === null) {
    throw new Error('Sign-in callback is missing its code or state.')
  }

  // State is our CSRF guard: a verifier exists only for a state WE generated. A missing
  // entry means a stale, replayed, or forged callback — reject it.
  const storageKey = STORAGE_PREFIX + state
  const raw = sessionStorage.getItem(storageKey)
  sessionStorage.removeItem(storageKey)
  if (raw === null) {
    throw new Error('Sign-in could not be verified (state mismatch). Please try again.')
  }
  const pending = JSON.parse(raw) as PendingOAuth

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
    client_id: authConfig.projectId,
    client_secret: authConfig.publishableClientKey,
  })
  const res = await fetch(`${authConfig.hexclaveApiBaseUrl}/api/v1/auth/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`Sign-in could not be completed (${res.status}).`)
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown }
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new Error('Sign-in returned an unexpected response.')
  }
  setTokens({ accessToken: data.access_token, refreshToken: data.refresh_token })
}
