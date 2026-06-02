import { parseScopes } from '@walnut/core'
import { Elysia, t } from 'elysia'
import { extractBearer } from '../auth/bearer.ts'
import type { AppContext } from '../context.ts'
import { badRequest, HttpError, unauthorized } from '../errors.ts'
import { toScopeRequestView } from '../serializers.ts'
import { recordQueryEvent } from '../services/activity.ts'
import { findAgentByKey, getAgentGrant } from '../services/agents.ts'
import { getProjectInternal } from '../services/projects.ts'
import { runAgentQuery } from '../services/query.ts'
import { createScopeRequest, listAgentScopeRequests } from '../services/scope-requests.ts'

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
      // The agent's access to its home project. Every agent has this grant from birth.
      const grant = await getAgentGrant(ctx, agent.id, 'project', agent.projectId)
      if (grant === undefined) {
        throw unauthorized('Agent has no grant; recreate it.')
      }
      return { agent, project, grant }
    })
    .get('/identity', ({ agent, project, grant }) => ({
      id: agent.id,
      name: agent.name,
      scopes: grant.scopes,
      project: { id: project.id, name: project.name, status: project.status },
    }))
    .post(
      '/query',
      async ({ agent, project, grant, body }) => {
        const startedAt = Date.now()
        try {
          const result = await runAgentQuery(project, grant, body.sql)
          await recordQueryEvent(ctx, {
            agentId: agent.id,
            projectId: project.id,
            sql: body.sql,
            status: 'ok',
            command: result.command,
            requiredScopes: result.requiredScopes,
            rowCount: result.rowCount,
            durationMs: Date.now() - startedAt,
          })
          return result
        } catch (err) {
          // Record the two outcomes worth auditing: a scope denial and an engine error.
          // (Empty SQL / project-not-ready are client mistakes, not activity.)
          if (err instanceof HttpError && (err.body.error === 'insufficient_scope' || err.body.error === 'query_error')) {
            const required = Array.isArray(err.body.requiredScopes) ? (err.body.requiredScopes as string[]) : []
            await recordQueryEvent(ctx, {
              agentId: agent.id,
              projectId: project.id,
              sql: body.sql,
              status: err.body.error === 'insufficient_scope' ? 'denied' : 'error',
              requiredScopes: required,
              errorMessage: err.body.error === 'query_error' ? err.body.message : null,
              durationMs: Date.now() - startedAt,
            })
          }
          throw err
        }
      },
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
