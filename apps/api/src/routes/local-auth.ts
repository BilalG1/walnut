import { Elysia, t } from 'elysia'
import type { LocalAuth } from '../auth/local-auth.ts'
import { unauthorized } from '../errors.ts'

/**
 * Self-host auth endpoints, mounted only when the API runs in local auth mode (no
 * Hexclave — see index.ts/env.ts). They mint and refresh local sessions with no secret
 * key and no network, so a `git clone` self-host can sign in out of the box.
 *
 * Unlike the Hexclave dev-login bypass, this is NOT gated on NODE_ENV: local auth is a
 * legitimate (single-tenant) production mode for self-hosters. The gate is structural —
 * the routes simply aren't mounted unless the operator chose local auth by leaving
 * Hexclave unconfigured.
 */
export function localAuthRoutes(localAuth: LocalAuth) {
  return new Elysia({ prefix: '/auth/local' })
    .post('/login', ({ body }) => localAuth.login(body.email), {
      body: t.Object({
        // Optional: omit to sign in as the default local user; pass an email to use a
        // distinct (stable) identity for multi-user local testing.
        email: t.Optional(t.String({ minLength: 3, maxLength: 320, pattern: '^[^@\\s]+@[^@\\s]+$' })),
      }),
    })
    .post(
      '/refresh',
      async ({ body }) => {
        const session = await localAuth.refresh(body.refreshToken)
        if (session === null) {
          throw unauthorized('Invalid or expired refresh token.')
        }
        return session
      },
      { body: t.Object({ refreshToken: t.String() }) },
    )
}
