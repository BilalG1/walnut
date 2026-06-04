import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toScopeRequestView } from '../serializers.ts'
import { listScopeRequests, resolveScopeRequest } from '../services/scope-requests.ts'
import { uuid } from '../validation.ts'

const idParams = t.Object({ id: uuid })

export function scopeRequestRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/scope-requests' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get(
      '/',
      async ({ userId, query }) => {
        const rows = await listScopeRequests(ctx, userId, { status: query.status })
        return rows.map(toScopeRequestView)
      },
      {
        query: t.Object({
          status: t.Optional(
            t.Union([t.Literal('pending'), t.Literal('approved'), t.Literal('denied')]),
          ),
        }),
      },
    )
    .post(
      '/:id/approve',
      async ({ userId, params }) => {
        const { request } = await resolveScopeRequest(ctx, params.id, userId, 'approved')
        return toScopeRequestView(request)
      },
      { params: idParams },
    )
    .post(
      '/:id/deny',
      async ({ userId, params }) => {
        const { request } = await resolveScopeRequest(ctx, params.id, userId, 'denied')
        return toScopeRequestView(request)
      },
      { params: idParams },
    )

}
