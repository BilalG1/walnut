import { Elysia } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toAgentView } from '../serializers.ts'
import { deleteAgent, getAgent } from '../services/agents.ts'

export function agentRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/agents' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get('/:id', async ({ userId, params }) => {
      const { agent, grants } = await getAgent(ctx, params.id, userId)
      return toAgentView(agent, grants)
    })
    .delete('/:id', async ({ userId, params }) => {
      await deleteAgent(ctx, params.id, userId)
      return { deleted: true }
    })
}
