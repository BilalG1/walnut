import { Elysia, t } from 'elysia'
import type { AppContext } from '../context.ts'
import { toScopeRequestView } from '../serializers.ts'
import { listScopeRequests, resolveScopeRequest } from '../services/scope-requests.ts'

export function scopeRequestRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/scope-requests' })
    .get(
      '/',
      async ({ query }) => {
        const rows = await listScopeRequests(ctx, { status: query.status })
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
    .post('/:id/approve', async ({ params }) => {
      const { request } = await resolveScopeRequest(ctx, params.id, 'approved')
      return toScopeRequestView(request)
    })
    .post('/:id/deny', async ({ params }) => {
      const { request } = await resolveScopeRequest(ctx, params.id, 'denied')
      return toScopeRequestView(request)
    })
}
