import { type AgentScope, SYSTEM_USER_ID } from '@walnut/core'
import { projects, scopeRequests, type Agent, type ScopeRequest, type ScopeRequestStatus } from '@walnut/db'
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { grantScopes } from './agents.ts'

/** Dashboard view: scope requests across all of the user's projects. */
export async function listScopeRequests(
  ctx: AppContext,
  opts: { status?: ScopeRequestStatus } = {},
): Promise<ScopeRequest[]> {
  const rows = await ctx.db
    .select({ req: scopeRequests })
    .from(scopeRequests)
    .innerJoin(projects, eq(scopeRequests.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, SYSTEM_USER_ID),
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

export async function createScopeRequest(
  ctx: AppContext,
  agent: Agent,
  input: { scopes: AgentScope[]; reason?: string },
): Promise<ScopeRequest> {
  const [created] = await ctx.db
    .insert(scopeRequests)
    .values({
      agentId: agent.id,
      projectId: agent.projectId,
      scopes: input.scopes,
      reason: input.reason ?? null,
      status: 'pending',
    })
    .returning()
  if (created === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create scope request.' })
  }
  return created
}

async function getOwnedScopeRequest(ctx: AppContext, id: string): Promise<ScopeRequest> {
  const [row] = await ctx.db
    .select({ req: scopeRequests })
    .from(scopeRequests)
    .innerJoin(projects, eq(scopeRequests.projectId, projects.id))
    .where(and(eq(scopeRequests.id, id), eq(projects.userId, SYSTEM_USER_ID)))
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
  decision: 'approved' | 'denied',
): Promise<ResolvedScopeRequest> {
  const request = await getOwnedScopeRequest(ctx, id)
  if (request.status !== 'pending') {
    throw new HttpError(409, {
      error: 'already_resolved',
      message: `Scope request was already ${request.status}.`,
    })
  }

  if (decision === 'approved') {
    // Merge the requested scopes into the agent's grant for the anchored resource
    // (a project, today) and sync its Postgres role memberships.
    await grantScopes(ctx, request.agentId, 'project', request.projectId, request.scopes)
  }

  const [updated] = await ctx.db
    .update(scopeRequests)
    .set({ status: decision, resolvedAt: new Date() })
    .where(eq(scopeRequests.id, id))
    .returning()

  return { request: updated ?? request }
}
