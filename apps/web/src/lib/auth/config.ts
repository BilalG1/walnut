/** Frontend auth configuration, read from Vite env vars at build time. */
function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

export const authConfig = {
  /** The Walnut API base (dashboard + dev-login). */
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
  /** Hexclave API base, for OAuth + token refresh. */
  hexclaveApiBaseUrl: import.meta.env.VITE_HEXCLAVE_API_BASE_URL ?? 'https://api.hexclave.com',
  /** Hexclave project id (OAuth `client_id`). */
  projectId: import.meta.env.VITE_HEXCLAVE_PROJECT_ID ?? '',
  /** Publishable client key (OAuth `client_secret` — not actually secret). */
  publishableClientKey: import.meta.env.VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? '',
  /** Show the dev-login form. On by default in `vite dev`; off in production builds
   * unless VITE_AUTH_DEV_BYPASS is explicitly set. */
  devBypass: flag(import.meta.env.VITE_AUTH_DEV_BYPASS) || import.meta.env.DEV === true,
}
