import { Elysia, t } from 'elysia'
import type { HexclaveServerClient } from '../auth/hexclave-server.ts'
import { HttpError } from '../errors.ts'

/**
 * DEV-ONLY login bypass. Trades an email for a real Hexclave session: get-or-create the
 * user, then mint access/refresh tokens server-side. Local dev (and manual testing) can
 * sign in without the OAuth UI while still exercising the ENTIRE real path downstream —
 * the tokens are genuine Hexclave tokens, verified against the real JWKS like any other.
 *
 * Defense in depth keeps this out of production (each lock is independently sufficient):
 *   1. Only mounted when AUTH_DEV_BYPASS is on AND NODE_ENV != production (env.ts/index.ts).
 *   2. Can't function without the secret server key, which is absent from prod env.
 *   3. Re-checks NODE_ENV here and fails closed even if it were somehow mounted.
 */
export function devAuthRoutes(client: HexclaveServerClient) {
  return new Elysia({ prefix: '/dev/auth' }).post(
    '/login',
    async ({ body }) => {
      if (process.env.NODE_ENV === 'production') {
        throw new HttpError(404, { error: 'not_found', message: 'Route not found.' })
      }
      const user = await client.getOrCreateUser(body.email)
      const session = await client.createSession(user.id)
      return { accessToken: session.accessToken, refreshToken: session.refreshToken }
    },
    {
      body: t.Object({
        email: t.String({ minLength: 3, maxLength: 320, pattern: '^[^@\\s]+@[^@\\s]+$' }),
      }),
    },
  )
}
