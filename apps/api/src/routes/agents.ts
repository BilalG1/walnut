import { Elysia } from 'elysia'
import type { AppContext } from '../context.ts'
import { toAgentView } from '../serializers.ts'
import { deleteAgent, getAgent } from '../services/agents.ts'

export function agentRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/agents' })
    .get('/:id', async ({ params }) => toAgentView(await getAgent(ctx, params.id)))
    .delete('/:id', async ({ params }) => {
      await deleteAgent(ctx, params.id)
      return { deleted: true }
    })
}
