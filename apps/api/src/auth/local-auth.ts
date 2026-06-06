import { uuidv5 } from '@walnut/core'
import { createLocalKeypair } from './local-keypair.ts'
import type { AuthVerifier } from './verify.ts'

/**
 * Self-hosted auth: a fully offline, passwordless identity provider used when Hexclave
 * isn't configured (the self-host default — see env.ts). An in-memory ES256 keypair
 * (see local-keypair.ts) both verifies access tokens — the same `jwtVerify` path as the
 * Hexclave verifier — and mints Hexclave-shaped tokens, with no network, no secret key,
 * and no signup.
 *
 * Design notes:
 *  - The user id (`sub`) is a deterministic UUIDv5 of the email, so the SAME email always
 *    maps to the SAME platform user/org. The signing keypair is ephemeral (regenerated each
 *    boot), which is harmless: a stale token simply fails verification and the dashboard
 *    silently re-mints one for the same stable user id (it auto-signs-in in local mode).
 *  - Access and refresh tokens use DIFFERENT audiences so an access verifier can never
 *    accept a refresh token (and vice versa) — refresh is stateless, no server-side store.
 */
export const LOCAL_AUTH_ISSUER = 'https://auth.walnut.local'
export const LOCAL_AUTH_AUDIENCE = 'walnut-local'
const LOCAL_REFRESH_AUDIENCE = 'walnut-local-refresh'
/** The single default identity a self-host instance signs in as with zero input. */
export const DEFAULT_LOCAL_EMAIL = 'user@walnut.local'
const LOCAL_KID = 'walnut-local-key'
const ACCESS_TTL = '1h'
const REFRESH_TTL = '30d'

/** Fixed namespace for deriving stable user ids from emails (UUIDv5). Arbitrary but
 * constant — changing it would re-key every local user, so it never changes. */
const LOCAL_USER_NAMESPACE = 'b9d5a3e2-1c4f-5a7b-8e6d-2f0a1b3c4d5e'

export interface LocalSession {
  accessToken: string
  refreshToken: string
}

export interface LocalAuth {
  /** Verifies local access tokens (the dashboard `AuthVerifier`). */
  verifier: AuthVerifier
  /** Mint a fresh access + refresh session for an email (defaults to the single local user). */
  login(email?: string): Promise<LocalSession>
  /** Exchange a valid local refresh token for a new session; null if it's invalid/expired. */
  refresh(refreshToken: string): Promise<LocalSession | null>
}

/** A friendly display name from the email local-part (e.g. `user@walnut.local` -> `User`). */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local.charAt(0).toUpperCase() + local.slice(1)
}

export async function createLocalAuth(): Promise<LocalAuth> {
  const keypair = await createLocalKeypair({
    kid: LOCAL_KID,
    issuer: LOCAL_AUTH_ISSUER,
    audience: LOCAL_AUTH_AUDIENCE,
  })

  async function mintSession(userId: string, email: string, name: string): Promise<LocalSession> {
    const [accessToken, refreshToken] = await Promise.all([
      keypair.sign({ role: 'authenticated', email, name, sub: userId }, { audience: LOCAL_AUTH_AUDIENCE, expiresIn: ACCESS_TTL }),
      keypair.sign({ typ: 'refresh', email, name, sub: userId }, { audience: LOCAL_REFRESH_AUDIENCE, expiresIn: REFRESH_TTL }),
    ])
    return { accessToken, refreshToken }
  }

  return {
    verifier: keypair.verifier,
    login(email = DEFAULT_LOCAL_EMAIL): Promise<LocalSession> {
      const normalized = email.trim().toLowerCase()
      return mintSession(uuidv5(LOCAL_USER_NAMESPACE, normalized), normalized, nameFromEmail(normalized))
    },
    async refresh(refreshToken: string): Promise<LocalSession | null> {
      const payload = await keypair.verifyAt(refreshToken, LOCAL_REFRESH_AUDIENCE)
      if (payload === null || payload.typ !== 'refresh' || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        return null
      }
      // Re-mint against the SAME sub so a refresh can never silently change identity.
      const name = typeof payload.name === 'string' ? payload.name : nameFromEmail(payload.email)
      return mintSession(payload.sub, payload.email, name)
    },
  }
}
