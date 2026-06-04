import { Elysia, t } from 'elysia'
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
import { idParams, uuid } from '../validation.ts'

// Agent and grant ids are Postgres `uuid`s (validate → 422, not a 500 from the cast). The
// trailing `:scope` is a scope string (e.g. `db:read`), so it stays a string.
const grantParams = t.Object({ id: uuid, grantId: uuid })
const grantScopeParams = t.Object({ id: uuid, grantId: uuid, scope: t.String() })

export function agentRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/agents' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get(
      '/:id',
      async ({ userId, params }) => {
        const { agent, grants, resourceNames } = await getAgentDetail(ctx, params.id, userId)
        return toAgentDetailView(agent, grants, resourceNames)
      },
      { params: idParams },
    )
    .delete(
      '/:id',
      async ({ userId, params }) => {
        await deleteAgent(ctx, params.id, userId)
        return { deleted: true }
      },
      { params: idParams },
    )
    .post(
      '/:id/rotate-key',
      async ({ userId, params }) => {
        // Mint a fresh one-time key (the old one stops working). The onboarding wizard uses
        // this to recover a key after a page reload, since the plaintext is never persisted.
        const { agent, grants, apiKey } = await rotateAgentKey(ctx, params.id, userId)
        return { ...toAgentView(agent, grants), apiKey }
      },
      { params: idParams },
    )
    // Revoke an agent's entire grant on a resource (all scopes there). Pure metadata delete:
    // the agent's next query resolves to a lesser/no scoped connection.
    .delete(
      '/:id/grants/:grantId',
      async ({ userId, params }) => {
        await revokeGrant(ctx, params.id, params.grantId, userId)
        return { revoked: true }
      },
      { params: grantParams },
    )
    // Revoke one scope from a grant (e.g. drop db:write but keep db:read). Removes the grant
    // too if it was the last scope.
    .delete(
      '/:id/grants/:grantId/scopes/:scope',
      async ({ userId, params }) => {
        await revokeGrantScope(ctx, params.id, params.grantId, params.scope, userId)
        return { revoked: true }
      },
      { params: grantScopeParams },
    )
}
