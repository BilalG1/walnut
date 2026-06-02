import {
  type AgentScope,
  createAgentRole,
  dropAgentRole,
  hashKey,
  keyPrefix,
  newAgentKey,
  parseScopes,
  syncAgentScopes,
} from '@walnut/core'
import { agentGrants, agents, type Agent, type AgentGrant, type GrantResourceType } from '@walnut/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { getProject, getProjectInternal } from './projects.ts'

/** An agent plus its grants — the unit the dashboard and serializers care about. */
export interface AgentWithGrants {
  agent: Agent
  grants: AgentGrant[]
}

/** Load the grants for many agents at once, grouped by agent id (empty array if none). */
async function grantsByAgent(ctx: AppContext, agentIds: string[]): Promise<Map<string, AgentGrant[]>> {
  const byAgent = new Map<string, AgentGrant[]>(agentIds.map((id) => [id, []]))
  if (agentIds.length === 0) {
    return byAgent
  }
  const rows = await ctx.db.select().from(agentGrants).where(inArray(agentGrants.agentId, agentIds))
  for (const grant of rows) {
    byAgent.get(grant.agentId)?.push(grant)
  }
  return byAgent
}

export async function listAgents(
  ctx: AppContext,
  projectId: string,
  userId: string,
): Promise<AgentWithGrants[]> {
  await getProject(ctx, projectId, userId)
  const rows = await ctx.db
    .select()
    .from(agents)
    .where(eq(agents.projectId, projectId))
    .orderBy(desc(agents.createdAt))
  const grants = await grantsByAgent(
    ctx,
    rows.map((a) => a.id),
  )
  return rows.map((agent) => ({ agent, grants: grants.get(agent.id) ?? [] }))
}

export interface CreatedAgent extends AgentWithGrants {
  /** Plaintext API key — returned only once, never persisted. */
  apiKey: string
}

export async function createAgent(
  ctx: AppContext,
  projectId: string,
  userId: string,
  input: { name: string },
): Promise<CreatedAgent> {
  const project = await getProject(ctx, projectId, userId)
  if (project.connectionUri === null) {
    throw new HttpError(409, {
      error: 'project_not_ready',
      message: `Project is "${project.status}"; cannot create an agent until its database is provisioned.`,
    })
  }

  // Provision the agent's restricted Postgres role up front; its queries run over
  // this connection, never the project owner connection.
  const { role, connectionUri } = await createAgentRole(project.connectionUri)

  const apiKey = newAgentKey()
  let result: AgentWithGrants
  try {
    result = await ctx.db.transaction(async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({
          projectId,
          name: input.name,
          keyHash: hashKey(apiKey),
          keyPrefix: keyPrefix(apiKey),
        })
        .returning()
      if (agent === undefined) {
        throw new Error('Failed to insert agent row.')
      }
      const [grant] = await tx
        .insert(agentGrants)
        .values({ agentId: agent.id, resourceType: 'project', resourceId: projectId, scopes: [], dbRole: role, connectionUri })
        .returning()
      if (grant === undefined) {
        throw new Error('Failed to insert agent grant row.')
      }
      return { agent, grants: [grant] }
    })
  } catch (err) {
    // Roll back the just-created role on any failure so we don't leak it.
    await rollbackAgentRole(project.connectionUri, role)
    throw err instanceof HttpError
      ? err
      : new HttpError(500, { error: 'internal_error', message: 'Failed to create agent.' })
  }
  return { ...result, apiKey }
}

/** Best-effort drop of an agent role during error recovery; logs but never throws. */
async function rollbackAgentRole(ownerUri: string, role: string): Promise<void> {
  await dropAgentRole(ownerUri, role).catch((e) => {
    console.error(`Failed to roll back orphaned agent role ${role}:`, e)
  })
}

export async function getAgent(ctx: AppContext, id: string, userId: string): Promise<AgentWithGrants> {
  const [row] = await ctx.db.select().from(agents).where(eq(agents.id, id)).limit(1)
  if (row === undefined) {
    throw notFound('Agent')
  }
  // Confirm the agent's project belongs to the caller.
  await getProject(ctx, row.projectId, userId)
  const grants = await ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, id))
  return { agent: row, grants }
}

export async function deleteAgent(ctx: AppContext, id: string, userId: string): Promise<void> {
  const { agent, grants } = await getAgent(ctx, id, userId)
  for (const grant of grants) {
    if (grant.dbRole === null) {
      continue
    }
    // Each grant's role lives in its resource's database (a project, for now).
    // eslint-disable-next-line no-await-in-loop
    const project = await getProjectInternal(ctx, grant.resourceId)
    if (project.connectionUri !== null) {
      // Best-effort: still remove the metadata row even if the role teardown fails,
      // matching deleteProject's philosophy (don't strand the user's delete).
      // eslint-disable-next-line no-await-in-loop
      await dropAgentRole(project.connectionUri, grant.dbRole).catch((e) => {
        console.error(`Failed to drop Postgres role for agent ${agent.id}:`, e)
      })
    }
  }
  // Cascade removes the agent's grant rows.
  await ctx.db.delete(agents).where(eq(agents.id, agent.id))
}

export async function findAgentByKey(ctx: AppContext, key: string): Promise<Agent | undefined> {
  const [row] = await ctx.db.select().from(agents).where(eq(agents.keyHash, hashKey(key))).limit(1)
  return row
}

/** The agent's grant for a given resource (its access there), if any. */
export async function getAgentGrant(
  ctx: AppContext,
  agentId: string,
  resourceType: GrantResourceType,
  resourceId: string,
): Promise<AgentGrant | undefined> {
  const [row] = await ctx.db
    .select()
    .from(agentGrants)
    .where(
      and(
        eq(agentGrants.agentId, agentId),
        eq(agentGrants.resourceType, resourceType),
        eq(agentGrants.resourceId, resourceId),
      ),
    )
    .limit(1)
  return row
}

/**
 * Merge new scopes into an agent's grant for a resource, validated and deduplicated.
 * Also reconciles the agent's Postgres role memberships so the database engine
 * enforces the new grant.
 */
export async function grantScopes(
  ctx: AppContext,
  agentId: string,
  resourceType: GrantResourceType,
  resourceId: string,
  add: readonly AgentScope[],
): Promise<AgentGrant> {
  const existing = await getAgentGrant(ctx, agentId, resourceType, resourceId)
  if (existing === undefined) {
    // For the MVP a grant is created with the agent, so this is an invariant break.
    throw new HttpError(500, {
      error: 'internal_error',
      message: 'Agent has no grant for this resource.',
    })
  }

  const merged = parseScopes([...existing.scopes, ...add])
  const [updated] = await ctx.db
    .update(agentGrants)
    .set({ scopes: merged })
    .where(eq(agentGrants.id, existing.id))
    .returning()
  const result = updated ?? existing

  if (result.dbRole !== null) {
    const project = await getProjectInternal(ctx, resourceId)
    if (project.connectionUri !== null) {
      await syncAgentScopes(project.connectionUri, result.dbRole, merged)
    }
  }
  return result
}
