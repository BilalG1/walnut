import { Elysia } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { acceptInvitation, previewInvitation } from '../services/invitations.ts'

/**
 * Token-addressed invite endpoints, mounted outside the `/:orgId` tree because the org isn't known
 * until the token resolves. Both require a signed-in user (the redeemer): preview drives the accept
 * page, accept joins them to the org. The token is the link's secret, carried in the path.
 */
export function invitationRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/invitations' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get('/:token', async ({ userId, params }) => previewInvitation(ctx, params.token, userId))
    .post('/:token/accept', async ({ userId, params }) => acceptInvitation(ctx, params.token, userId))
}
