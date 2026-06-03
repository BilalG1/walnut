import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import {
  toAgentView,
  toOrgAgentView,
  toOrgProjectSummary,
  toOrgSummary,
  toProjectDetail,
  toScopeRequestView,
} from '../serializers.ts'
import { createAgent, listOrgAgents } from '../services/agents.ts'
import { listOrganizations } from '../services/organizations.ts'
import { createProject, getDefaultBranch, listOrgProjects } from '../services/projects.ts'
import { listOrgScopeRequests } from '../services/scope-requests.ts'

export function organizationRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/organizations' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get('/', async ({ userId }) => {
      const rows = await listOrganizations(ctx, userId)
      return rows.map(({ organization, role }) => toOrgSummary(organization, role))
    })
    .get('/:orgId/projects', async ({ userId, params }) => {
      const rows = await listOrgProjects(ctx, params.orgId, userId)
      return rows.map((r) =>
        toOrgProjectSummary(r.project, {
          agentCount: r.agentCount,
          pendingRequestCount: r.pendingRequestCount,
          defaultBranch: r.defaultBranch,
        }),
      )
    })
    .post(
      '/:orgId/projects',
      async ({ userId, params, body }) => {
        const project = await createProject(ctx, userId, body, params.orgId)
        const main = await getDefaultBranch(ctx, project.id)
        return toProjectDetail(project, main.connectionUri)
      },
      { body: t.Object({ name: t.String({ minLength: 1, maxLength: 64 }) }) },
    )
    .get('/:orgId/agents', async ({ userId, params }) => {
      const rows = await listOrgAgents(ctx, params.orgId, userId)
      return rows.map((r) => toOrgAgentView(r.agent, r.grants, r.projectNames))
    })
    .post(
      '/:orgId/agents',
      async ({ userId, params, body }) => {
        // Agents are org-scoped and born grant-less; the user grants them per-project
        // access by approving their scope requests.
        const { agent, grants, apiKey } = await createAgent(ctx, params.orgId, userId, body)
        return { ...toAgentView(agent, grants), apiKey }
      },
      { body: t.Object({ name: t.String({ minLength: 1, maxLength: 64 }) }) },
    )
    .get(
      '/:orgId/requests',
      async ({ userId, params, query }) => {
        const rows = await listOrgScopeRequests(ctx, params.orgId, userId, { status: query.status })
        return rows.map(toScopeRequestView)
      },
      {
        query: t.Object({
          status: t.Optional(t.Union([t.Literal('pending'), t.Literal('approved'), t.Literal('denied')])),
        }),
      },
    )
}
