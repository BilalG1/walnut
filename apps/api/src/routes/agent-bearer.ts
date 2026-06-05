import type { Agent } from '@walnut/db'
import { extractBearer } from '../auth/bearer.ts'
import type { AppContext } from '../context.ts'
import { unauthorized } from '../errors.ts'
import { findAgentByKey } from '../services/agents.ts'

/**
 * The shared `.resolve` for agent-facing route plugins: extract the bearer key, look it up, and
 * expose the authenticated `agent` to every handler (401 on a missing/invalid key). Used by both
 * `agentApiRoutes` and `storageApiRoutes`, which are separate Elysia plugins under `/agent/v1`.
 */
export function agentBearerResolver(ctx: AppContext) {
  return async ({ headers }: { headers: Record<string, string | undefined> }): Promise<{ agent: Agent }> => {
    const token = extractBearer(headers.authorization)
    if (token === undefined) {
      throw unauthorized('Missing agent API key. Pass it as `Authorization: Bearer <key>`.')
    }
    const agent = await findAgentByKey(ctx, token)
    if (agent === undefined) {
      throw unauthorized('Invalid agent API key.')
    }
    return { agent }
  }
}
