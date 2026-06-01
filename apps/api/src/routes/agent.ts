import { parseScopes } from '@walnut/core'
import { Elysia, t } from 'elysia'
import type { AppContext } from '../context.ts'
import { badRequest, unauthorized } from '../errors.ts'
import { toScopeRequestView } from '../serializers.ts'
import { findAgentByKey } from '../services/agents.ts'
import { getProjectInternal } from '../services/projects.ts'
import { runAgentQuery } from '../services/query.ts'
import { createScopeRequest, listAgentScopeRequests } from '../services/scope-requests.ts'

function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token !== undefined && token.length > 0 ? token : undefined
}

export function agentApiRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/agent/v1' })
    .resolve(async ({ headers }) => {
      const token = extractBearer(headers.authorization)
      if (token === undefined) {
        throw unauthorized('Missing agent API key. Pass it as `Authorization: Bearer <key>`.')
      }
      const agent = await findAgentByKey(ctx, token)
      if (agent === undefined) {
        throw unauthorized('Invalid agent API key.')
      }
      const project = await getProjectInternal(ctx, agent.projectId)
      return { agent, project }
    })
    .get('/identity', ({ agent, project }) => ({
      id: agent.id,
      name: agent.name,
      scopes: agent.scopes,
      project: { id: project.id, name: project.name, status: project.status },
    }))
    .post(
      '/query',
      async ({ agent, project, body }) => runAgentQuery(project, agent, body.sql),
      { body: t.Object({ sql: t.String({ minLength: 1 }) }) },
    )
    .post(
      '/scope-requests',
      async ({ agent, body }) => {
        let scopes
        try {
          scopes = parseScopes(body.scopes)
        } catch (err) {
          throw badRequest(err instanceof Error ? err.message : 'Invalid scopes.')
        }
        const created = await createScopeRequest(ctx, agent, { scopes, reason: body.reason })
        return toScopeRequestView(created)
      },
      {
        body: t.Object({
          scopes: t.Array(t.String(), { minItems: 1 }),
          reason: t.Optional(t.String({ maxLength: 500 })),
        }),
      },
    )
    .get('/scope-requests', async ({ agent }) => {
      const rows = await listAgentScopeRequests(ctx, agent.id)
      return rows.map(toScopeRequestView)
    })
}
