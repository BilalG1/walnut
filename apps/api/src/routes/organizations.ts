import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import {
  toOrgAgentView,
  toOrgProjectSummary,
  toOrgSummary,
  toProjectDetail,
  toScopeRequestView,
} from '../serializers.ts'
import { listOrgAgents } from '../services/agents.ts'
import { listOrganizations } from '../services/organizations.ts'
import { createProject, listOrgProjects } from '../services/projects.ts'
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
      async ({ userId, params, body }) => toProjectDetail(await createProject(ctx, userId, body, params.orgId)),
      { body: t.Object({ name: t.String({ minLength: 1, maxLength: 64 }) }) },
    )
    .get('/:orgId/agents', async ({ userId, params }) => {
      const rows = await listOrgAgents(ctx, params.orgId, userId)
      return rows.map((r) => toOrgAgentView(r.agent, r.grants, r.projectNames))
    })
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
