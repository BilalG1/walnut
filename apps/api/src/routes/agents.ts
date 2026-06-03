import { Elysia } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toAgentDetailView, toAgentView } from '../serializers.ts'
import {
  deleteAgent,
  getAgentDetail,
  revokeGrant,
  revokeGrantScope,
  rotateAgentKey,
} from '../services/agents.ts'

export function agentRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/agents' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get('/:id', async ({ userId, params }) => {
      const { agent, grants, resourceNames } = await getAgentDetail(ctx, params.id, userId)
      return toAgentDetailView(agent, grants, resourceNames)
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
    // Revoke an agent's entire grant on a resource (all scopes there). Pure metadata delete:
    // the agent's next query resolves to a lesser/no scoped connection.
    .delete('/:id/grants/:grantId', async ({ userId, params }) => {
      await revokeGrant(ctx, params.id, params.grantId, userId)
      return { revoked: true }
    })
    // Revoke one scope from a grant (e.g. drop db:write but keep db:read). Removes the grant
    // too if it was the last scope.
    .delete('/:id/grants/:grantId/scopes/:scope', async ({ userId, params }) => {
      await revokeGrantScope(ctx, params.id, params.grantId, params.scope, userId)
      return { revoked: true }
    })
}
