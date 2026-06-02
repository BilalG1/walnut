import { type AgentScope, type GrantResourceType, parseScopesForResource } from '@walnut/core'
import {
  branches,
  organizationMembers,
  scopeRequests,
  type Agent,
  type ScopeRequest,
  type ScopeRequestStatus,
} from '@walnut/db'
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { badRequest, HttpError, notFound } from '../errors.ts'
import { grantScopes, resolveAgentProject } from './agents.ts'
import { assertOrgMember } from './organizations.ts'
import { getProjectInternal } from './projects.ts'

/** Scope requests for one organization (caller must be a member). */
export async function listOrgScopeRequests(
  ctx: AppContext,
  orgId: string,
  userId: string,
  opts: { status?: ScopeRequestStatus } = {},
): Promise<ScopeRequest[]> {
  await assertOrgMember(ctx, orgId, userId)
  return ctx.db
    .select()
    .from(scopeRequests)
    .where(
      and(
        eq(scopeRequests.organizationId, orgId),
        opts.status !== undefined ? eq(scopeRequests.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(scopeRequests.createdAt))
}

/** Dashboard view: scope requests across all of the user's organizations. */
export async function listScopeRequests(
  ctx: AppContext,
  userId: string,
  opts: { status?: ScopeRequestStatus } = {},
): Promise<ScopeRequest[]> {
  const rows = await ctx.db
    .select({ req: scopeRequests })
    .from(scopeRequests)
    .innerJoin(organizationMembers, eq(scopeRequests.organizationId, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        opts.status !== undefined ? eq(scopeRequests.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(scopeRequests.createdAt))
  return rows.map((r) => r.req)
}

/** An agent's own scope requests. */
export async function listAgentScopeRequests(ctx: AppContext, agentId: string): Promise<ScopeRequest[]> {
  return ctx.db
    .select()
    .from(scopeRequests)
    .where(eq(scopeRequests.agentId, agentId))
    .orderBy(desc(scopeRequests.createdAt))
}

/** Confirm a resource belongs to the org (and exists), else 404 — no existence leak. */
async function assertResourceInOrg(
  ctx: AppContext,
  orgId: string,
  resourceType: GrantResourceType,
  resourceId: string,
): Promise<void> {
  if (resourceType === 'org') {
    if (resourceId !== orgId) {
      throw notFound('Organization')
    }
    return
  }
  if (resourceType === 'branch') {
    const [branch] = await ctx.db
      .select({ projectId: branches.projectId })
      .from(branches)
      .where(eq(branches.id, resourceId))
      .limit(1)
    if (branch === undefined || (await getProjectInternal(ctx, branch.projectId)).organizationId !== orgId) {
      throw notFound('Branch')
    }
    return
  }
  if ((await getProjectInternal(ctx, resourceId)).organizationId !== orgId) {
    throw notFound('Project')
  }
}

export interface ScopeRequestInput {
  scopes: string[]
  reason?: string
  /** Target resource. Both must be supplied together; omit to default to the agent's sole
   * project — its single granted project, or the org's sole project if it has none yet
   * (it errors if there are zero or several to choose from). */
  resourceType?: GrantResourceType
  resourceId?: string
}

export async function createScopeRequest(ctx: AppContext, agent: Agent, input: ScopeRequestInput): Promise<ScopeRequest> {
  let resourceType: GrantResourceType
  let resourceId: string
  if (input.resourceType !== undefined || input.resourceId !== undefined) {
    if (input.resourceType === undefined || input.resourceId === undefined) {
      throw badRequest('resourceType and resourceId must be provided together.')
    }
    resourceType = input.resourceType
    resourceId = input.resourceId
    await assertResourceInOrg(ctx, agent.organizationId, resourceType, resourceId)
  } else {
    resourceType = 'project'
    resourceId = (await resolveAgentProject(ctx, agent)).id
  }

  let scopes: AgentScope[]
  try {
    scopes = parseScopesForResource(resourceType, input.scopes)
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Invalid scopes.')
  }

  const [created] = await ctx.db
    .insert(scopeRequests)
    .values({
      agentId: agent.id,
      organizationId: agent.organizationId,
      resourceType,
      resourceId,
      scopes,
      reason: input.reason ?? null,
      status: 'pending',
    })
    .returning()
  if (created === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create scope request.' })
  }
  return created
}

async function getOwnedScopeRequest(ctx: AppContext, id: string, userId: string): Promise<ScopeRequest> {
  const [row] = await ctx.db
    .select({ req: scopeRequests })
    .from(scopeRequests)
    .innerJoin(organizationMembers, eq(scopeRequests.organizationId, organizationMembers.organizationId))
    .where(and(eq(scopeRequests.id, id), eq(organizationMembers.userId, userId)))
    .limit(1)
  if (row === undefined) {
    throw notFound('Scope request')
  }
  return row.req
}

export interface ResolvedScopeRequest {
  request: ScopeRequest
}

export async function resolveScopeRequest(
  ctx: AppContext,
  id: string,
  userId: string,
  decision: 'approved' | 'denied',
): Promise<ResolvedScopeRequest> {
  const request = await getOwnedScopeRequest(ctx, id, userId)
  if (request.status !== 'pending') {
    throw new HttpError(409, {
      error: 'already_resolved',
      message: `Scope request was already ${request.status}.`,
    })
  }

  if (decision === 'approved') {
    // Merge the requested scopes into the agent's grant for the anchored resource and
    // sync its Postgres role memberships (provisioning the grant/role if it's the first).
    await grantScopes(ctx, request.agentId, request.resourceType, request.resourceId, request.scopes)
  }

  const [updated] = await ctx.db
    .update(scopeRequests)
    .set({ status: decision, resolvedAt: new Date() })
    .where(eq(scopeRequests.id, id))
    .returning()

  return { request: updated ?? request }
}
