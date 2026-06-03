import { Elysia } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toMeView } from '../serializers.ts'
import { completeOnboarding, getUser } from '../services/users.ts'

/** The authenticated user's own profile + first-run onboarding state. Separate from
 * `/api/organizations` because onboarding is a per-user fact, not a per-org one. */
export function meRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/me' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get('/', async ({ userId }) => toMeView(await getUser(ctx, userId)))
    .post('/onboarding/complete', async ({ userId }) => toMeView(await completeOnboarding(ctx, userId)))
}
