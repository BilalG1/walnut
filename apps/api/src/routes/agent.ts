import { Elysia, t } from 'elysia'
import { extractBearer } from '../auth/bearer.ts'
import type { AppContext } from '../context.ts'
import { HttpError, unauthorized } from '../errors.ts'
import { toScopeRequestView } from '../serializers.ts'
import { recordQueryEvent } from '../services/activity.ts'
import { findAgentByKey, getAgentGrant, getAgentHomeProject, resolveAgentProject } from '../services/agents.ts'
import { branchExists, listProjectsInOrg } from '../services/projects.ts'
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
      return { agent }
    })
    .get('/identity', async ({ agent }) => {
      // An org-scoped agent has no single project; report its home project (the first it
      // was granted) and that grant's scopes, plus the org it belongs to.
      const home = await getAgentHomeProject(ctx, agent)
      return {
        id: agent.id,
        name: agent.name,
        organization: { id: agent.organizationId },
        scopes: home?.scopes ?? [],
        project: home === null ? null : { id: home.project.id, name: home.project.name, status: home.project.status },
      }
    })
    // The projects the agent could target or request access to — everything in its org, so
    // it can discover ids for `--project` (and for scope requests on projects it can't reach
    // yet). Deliberately minimal: id + name only.
    .get('/projects', async ({ agent }) => {
      const rows = await listProjectsInOrg(ctx, agent.organizationId)
      return rows.map((p) => ({ id: p.id, name: p.name }))
    })
    .post(
      '/query',
      async ({ agent, body }) => {
        // Pick the target project (explicit, or the agent's sole granted project) and run
        // over its scoped grant — defense in depth behind the SQL classifier.
        const project = await resolveAgentProject(ctx, agent, body.projectId)
        if (body.branch !== undefined && !(await branchExists(ctx, project.id, body.branch))) {
          throw new HttpError(404, {
            error: 'branch_not_found',
            message: `No branch "${body.branch}" on this project.`,
          })
        }
        const grant = await getAgentGrant(ctx, agent.id, 'project', project.id)
        const startedAt = Date.now()
        try {
          const result = await runAgentQuery(
            project,
            { scopes: grant?.scopes ?? [], connectionUri: grant?.connectionUri ?? null },
            body.sql,
          )
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
      {
        body: t.Object({
          sql: t.String({ minLength: 1 }),
          projectId: t.Optional(t.String()),
          branch: t.Optional(t.String()),
        }),
      },
    )
    .post(
      '/scope-requests',
      async ({ agent, body }) => {
        const created = await createScopeRequest(ctx, agent, {
          scopes: body.scopes,
          reason: body.reason,
          resourceType: body.resourceType,
          resourceId: body.resourceId,
        })
        return toScopeRequestView(created)
      },
      {
        body: t.Object({
          scopes: t.Array(t.String(), { minItems: 1 }),
          reason: t.Optional(t.String({ maxLength: 500 })),
          resourceType: t.Optional(t.Union([t.Literal('org'), t.Literal('project'), t.Literal('branch')])),
          resourceId: t.Optional(t.String()),
        }),
      },
    )
    .get('/scope-requests', async ({ agent }) => {
      const rows = await listAgentScopeRequests(ctx, agent.id)
      return rows.map(toScopeRequestView)
    })
}
