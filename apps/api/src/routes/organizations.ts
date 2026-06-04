import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import {
  toAgentView,
  toInvitationView,
  toMemberView,
  toOrgAgentView,
  toOrgProjectSummary,
  toOrgSummary,
  toOrgUsageView,
  toProjectDetail,
  toScopeRequestView,
} from '../serializers.ts'
import { createAgent, listOrgAgents } from '../services/agents.ts'
import { createInvitation, listInvitations, revokeInvitation } from '../services/invitations.ts'
import { getOrgUsage, listMembers, listOrganizations, removeMember } from '../services/organizations.ts'
import { createProject, getDefaultBranch, listOrgProjects } from '../services/projects.ts'
import { listOrgScopeRequests } from '../services/scope-requests.ts'
import { nameSchema, uuid } from '../validation.ts'

// Path-param schemas: every org/member/invitation id is a Postgres `uuid`, so reject a
// non-UUID with a clean 422 before it reaches the DB cast (see validation.ts).
const orgParams = t.Object({ orgId: uuid })
const memberParams = t.Object({ orgId: uuid, memberId: uuid })
const invitationParams = t.Object({ orgId: uuid, invitationId: uuid })

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
    .get(
      '/:orgId/projects',
      async ({ userId, params }) => {
        const rows = await listOrgProjects(ctx, params.orgId, userId)
        return rows.map((r) =>
          toOrgProjectSummary(r.project, {
            agentCount: r.agentCount,
            pendingRequestCount: r.pendingRequestCount,
            defaultBranch: r.defaultBranch,
          }),
        )
      },
      { params: orgParams },
    )
    .post(
      '/:orgId/projects',
      async ({ userId, params, body }) => {
        const project = await createProject(ctx, userId, body, params.orgId)
        const main = await getDefaultBranch(ctx, project.id)
        return toProjectDetail(project, main.connectionUri)
      },
      { params: orgParams, body: t.Object({ name: nameSchema }) },
    )
    .get(
      '/:orgId/agents',
      async ({ userId, params }) => {
        const rows = await listOrgAgents(ctx, params.orgId, userId)
        return rows.map((r) => toOrgAgentView(r.agent, r.grants, r.projectNames))
      },
      { params: orgParams },
    )
    .post(
      '/:orgId/agents',
      async ({ userId, params, body }) => {
        // Agents are org-scoped and born grant-less; the user grants them per-project
        // access by approving their scope requests.
        const { agent, grants, apiKey } = await createAgent(ctx, params.orgId, userId, body)
        return { ...toAgentView(agent, grants), apiKey }
      },
      { params: orgParams, body: t.Object({ name: nameSchema }) },
    )
    .get(
      '/:orgId/usage',
      async ({ userId, params }) => {
        const counts = await getOrgUsage(ctx, params.orgId, userId)
        return toOrgUsageView(counts)
      },
      { params: orgParams },
    )
    .get(
      '/:orgId/members',
      async ({ userId, params }) => {
        const rows = await listMembers(ctx, params.orgId, userId)
        return rows.map(toMemberView)
      },
      { params: orgParams },
    )
    .delete(
      '/:orgId/members/:memberId',
      async ({ userId, params }) => {
        await removeMember(ctx, params.orgId, params.memberId, userId)
        return { removed: true }
      },
      { params: memberParams },
    )
    .post(
      '/:orgId/invitations',
      async ({ userId, params, body }) => {
        // Link-only: returns the one-time token so the UI can build a shareable link. No invitee
        // email — the token is the capability, bounded by single use + expiry + revocation.
        const { invitation, token } = await createInvitation(ctx, params.orgId, userId, { role: body.role })
        return { ...toInvitationView(invitation), token }
      },
      { params: orgParams, body: t.Object({ role: t.Optional(t.Union([t.Literal('member'), t.Literal('admin')])) }) },
    )
    .get(
      '/:orgId/invitations',
      async ({ userId, params }) => {
        const rows = await listInvitations(ctx, params.orgId, userId)
        return rows.map(toInvitationView)
      },
      { params: orgParams },
    )
    .delete(
      '/:orgId/invitations/:invitationId',
      async ({ userId, params }) => {
        await revokeInvitation(ctx, params.orgId, params.invitationId, userId)
        return { revoked: true }
      },
      { params: invitationParams },
    )
    .get(
      '/:orgId/requests',
      async ({ userId, params, query }) => {
        const rows = await listOrgScopeRequests(ctx, params.orgId, userId, { status: query.status })
        return rows.map(toScopeRequestView)
      },
      {
        params: orgParams,
        query: t.Object({
          status: t.Optional(t.Union([t.Literal('pending'), t.Literal('approved'), t.Literal('denied')])),
        }),
      },
    )
}
