/**
 * Public, hosted Walnut URLs. Unlike {@link ./ports.ts} (which derives *local* ports
 * from `PORT_PREFIX`), these are the production defaults the apps fall back to when no
 * environment override is set. Kept here — a leaf module with no Node imports — so both
 * the browser bundle (`apps/web`) and the CLI can import them safely.
 */

/** Default agent-facing API base. The CLI targets this unless `walnut login --api-url`
 * (or a stored override) points elsewhere; the dashboard compares against it to decide
 * whether the displayed `walnut login` command needs an explicit `--api-url` flag. */
export const DEFAULT_WALNUT_API_URL = 'https://api.walnut.sh'

/** Default site origin that serves the CLI installer at `/install`. Used as the base of
 * the `curl … | sh` command shown during onboarding when no `VITE_INSTALL_URL` override
 * is set (local dev injects the prefix-derived `http://localhost:<web>` instead). */
export const DEFAULT_WALNUT_WEB_URL = 'https://walnut.sh'
