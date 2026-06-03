import { Elysia } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toAgentView } from '../serializers.ts'
import { deleteAgent, getAgent, rotateAgentKey } from '../services/agents.ts'

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
    .post('/:id/rotate-key', async ({ userId, params }) => {
      // Mint a fresh one-time key (the old one stops working). The onboarding wizard uses
      // this to recover a key after a page reload, since the plaintext is never persisted.
      const { agent, grants, apiKey } = await rotateAgentKey(ctx, params.id, userId)
      return { ...toAgentView(agent, grants), apiKey }
    })
}
