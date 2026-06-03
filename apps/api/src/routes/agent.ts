import { MAX_CONCURRENT_QUERIES_PER_BRANCH } from '@walnut/core'
import { Elysia, t } from 'elysia'
import { extractBearer } from '../auth/bearer.ts'
import type { AppContext } from '../context.ts'
import { HttpError, unauthorized } from '../errors.ts'
import { enforceRate } from '../rate-limit.ts'
import { toScopeRequestView } from '../serializers.ts'
import { recordQueryEvent } from '../services/activity.ts'
import { agentScopesForBranch, findAgentByKey, getAgentHomeProject, resolveAgentProject } from '../services/agents.ts'
import { listBranchesInternal, listProjectsInOrg, resolveBranch } from '../services/projects.ts'
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
    // The branches of a target project (explicit `projectId`, or the agent's sole project), so
    // an agent can discover names for `--branch` (on db query / scope request). id + name + default.
    .get(
      '/branches',
      async ({ agent, query }) => {
        const project = await resolveAgentProject(ctx, agent, query.projectId)
        const rows = await listBranchesInternal(ctx, project.id)
        return rows.map((b) => ({ id: b.id, name: b.name, isDefault: b.isDefault }))
      },
      { query: t.Object({ projectId: t.Optional(t.String()) }) },
    )
    .post(
      '/query',
      async ({ agent, body }) => {
        // Per-agent query rate limit (burst protection) before any work.
        enforceRate(ctx.rateLimiter, 'agentQuery', agent.id)
        // Pick the target project (explicit, or the agent's sole granted project) and the target
        // branch (named, or the default), then run over that branch's scoped connection for the
        // agent's effective scopes there (the union of its project + branch grants) — defense in
        // depth behind the SQL classifier.
        const project = await resolveAgentProject(ctx, agent, body.projectId)
        const branch = await resolveBranch(ctx, project.id, body.branch)
        const scopeRows = await agentScopesForBranch(ctx, agent.id, project.id, branch.id)
        // Cap concurrent in-flight queries per branch — each opens its own connection, so this
        // bounds connections to one branch DB regardless of how many agents target it at once.
        const release = ctx.rateLimiter.acquire(`branch:${branch.id}`, MAX_CONCURRENT_QUERIES_PER_BRANCH)
        if (release === null) {
          throw new HttpError(429, {
            error: 'too_many_concurrent_queries',
            message: `Too many concurrent queries on branch "${branch.name}". Retry shortly.`,
            limit: 'concurrent_queries_per_branch',
            retryAfterMs: 0,
          })
        }
        const startedAt = Date.now()
        try {
          const result = await runAgentQuery(ctx, branch, scopeRows, body.sql)
          await recordQueryEvent(ctx, {
            agentId: agent.id,
            projectId: project.id,
            branchId: branch.id,
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
          // (Empty SQL / branch-not-ready are client mistakes, not activity.)
          if (err instanceof HttpError && (err.body.error === 'insufficient_scope' || err.body.error === 'query_error')) {
            const required = Array.isArray(err.body.requiredScopes) ? (err.body.requiredScopes as string[]) : []
            await recordQueryEvent(ctx, {
              agentId: agent.id,
              projectId: project.id,
              branchId: branch.id,
              sql: body.sql,
              status: err.body.error === 'insufficient_scope' ? 'denied' : 'error',
              requiredScopes: required,
              errorMessage: err.body.error === 'query_error' ? err.body.message : null,
              durationMs: Date.now() - startedAt,
            })
          }
          throw err
        } finally {
          release()
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
        // Resolve the target. Explicit resourceType+resourceId wins (the raw form). Otherwise the
        // agent-friendly form: `branch` (a name) targets that branch of the project (explicit
        // `projectId` or the sole one); `projectId` alone targets the project; nothing → the
        // server's default (sole project, in createScopeRequest).
        let resourceType = body.resourceType
        let resourceId = body.resourceId
        if (resourceType === undefined || resourceId === undefined) {
          if (body.branch !== undefined) {
            const project = await resolveAgentProject(ctx, agent, body.projectId)
            const branch = await resolveBranch(ctx, project.id, body.branch)
            resourceType = 'branch'
            resourceId = branch.id
          } else if (body.projectId !== undefined) {
            resourceType = 'project'
            resourceId = (await resolveAgentProject(ctx, agent, body.projectId)).id
          }
        }
        const created = await createScopeRequest(ctx, agent, {
          scopes: body.scopes,
          reason: body.reason,
          expiresInSeconds: body.expiresInSeconds,
          resourceType,
          resourceId,
        })
        return toScopeRequestView(created)
      },
      {
        body: t.Object({
          scopes: t.Array(t.String(), { minItems: 1 }),
          reason: t.Optional(t.String({ maxLength: 500 })),
          /** Optional time-box (seconds) for the requested scopes; omit for permanent. */
          expiresInSeconds: t.Optional(t.Integer({ minimum: 1 })),
          /** Agent-friendly target: a project id and/or a branch *name*. */
          projectId: t.Optional(t.String()),
          branch: t.Optional(t.String()),
          /** Raw target (used by the dashboard); takes precedence when both are set. */
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
