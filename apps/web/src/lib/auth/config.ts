/** Frontend auth configuration, read from Vite env vars at build time. */
function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

/**
 * Sentinel sent as the OAuth `client_secret` when no publishable client key is
 * configured. The token endpoint rejects an empty/missing secret (400
 * INVALID_OAUTH_CLIENT_ID_OR_SECRET) but accepts this sentinel for projects that don't
 * require a real pck — verified empirically, and it's what the Hexclave SDK sends.
 */
const PUBLIC_CLIENT_SENTINEL = '__stack_public_client__'

const publishableClientKey = import.meta.env.VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? ''
const projectId = import.meta.env.VITE_HEXCLAVE_PROJECT_ID ?? ''

/**
 * Which auth provider the dashboard talks to. Mirrors the API's AUTH_PROVIDER resolution:
 * `local` (the self-host default — a built-in offline, passwordless provider) unless a
 * Hexclave project id is configured, in which case `hexclave`. `VITE_AUTH_PROVIDER` forces it.
 */
const authProvider = (import.meta.env.VITE_AUTH_PROVIDER ?? (projectId ? 'hexclave' : 'local')) as 'hexclave' | 'local'

export const authConfig = {
  /** The Walnut API base (dashboard + dev/local auth). */
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
  /** Hexclave API base, for OAuth + token refresh. */
  hexclaveApiBaseUrl: import.meta.env.VITE_HEXCLAVE_API_BASE_URL ?? 'https://api.hexclave.com',
  /** Hexclave project id (OAuth `client_id`). */
  projectId,
  /** The active auth provider (see above). */
  authProvider,
  /** True when running the built-in offline auth — the dashboard auto-signs-in. */
  localAuth: authProvider === 'local',
  /** Publishable client key, if configured (not actually secret). */
  publishableClientKey,
  /** The value to send as OAuth `client_secret`: the real pck if set, else the sentinel
   * so OAuth + refresh work without configuring a publishable client key. */
  oauthClientSecret: publishableClientKey || PUBLIC_CLIENT_SENTINEL,
  /** Show the dev-login form. On by default in `vite dev`; off in production builds
   * unless VITE_AUTH_DEV_BYPASS is explicitly set. */
  devBypass: flag(import.meta.env.VITE_AUTH_DEV_BYPASS) || import.meta.env.DEV === true,
}
