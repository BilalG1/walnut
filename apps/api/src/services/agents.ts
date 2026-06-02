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
import {
  agentGrants,
  agents,
  branches,
  projects,
  type Agent,
  type AgentGrant,
  type GrantResourceType,
  type Project,
} from '@walnut/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { assertOrgMember } from './organizations.ts'
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

/** Project names for a set of ids, as a lookup (missing ids are simply absent). */
async function projectNames(ctx: AppContext, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map()
  }
  const rows = await ctx.db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids))
  return new Map(rows.map((r) => [r.id, r.name]))
}

/**
 * The owner (admin) connection URI of a grantable resource's database, or null when the
 * resource has no database of its own (an `org`). A `branch` resolves to its parent
 * project's database (branches are inert today — the project's database *is* the branch).
 */
async function resourceConnectionUri(
  ctx: AppContext,
  resourceType: GrantResourceType,
  resourceId: string,
): Promise<string | null> {
  if (resourceType === 'org') {
    return null
  }
  if (resourceType === 'branch') {
    const [branch] = await ctx.db
      .select({ projectId: branches.projectId })
      .from(branches)
      .where(eq(branches.id, resourceId))
      .limit(1)
    if (branch === undefined) {
      throw notFound('Branch')
    }
    return (await getProjectInternal(ctx, branch.projectId)).connectionUri
  }
  return (await getProjectInternal(ctx, resourceId)).connectionUri
}

/** The ids of the projects an agent currently holds a project grant on. */
export async function agentProjectIds(ctx: AppContext, agentId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ resourceId: agentGrants.resourceId })
    .from(agentGrants)
    .where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.resourceType, 'project')))
  return [...new Set(rows.map((r) => r.resourceId))]
}

/**
 * Resolve which project an agent action targets. An explicit id wins (and must belong to
 * the agent's org). Otherwise default to the single project the agent has a grant on; 0
 * or >1 grants is an error the agent can act on (request access, or pass an explicit id).
 */
export async function resolveAgentProject(
  ctx: AppContext,
  agent: Agent,
  explicitProjectId?: string,
): Promise<Project> {
  if (explicitProjectId !== undefined) {
    const project = await getProjectInternal(ctx, explicitProjectId)
    if (project.organizationId !== agent.organizationId) {
      throw notFound('Project')
    }
    return project
  }
  const ids = await agentProjectIds(ctx, agent.id)
  const only = ids[0]
  if (only === undefined) {
    throw new HttpError(400, {
      error: 'no_project',
      message: 'Agent has access to no project. Ask the user to approve access to one (see `walnut project ls`).',
    })
  }
  if (ids.length > 1) {
    const names = await projectNames(ctx, ids)
    throw new HttpError(400, {
      error: 'ambiguous_project',
      message: 'Agent has access to multiple projects; pass --project <id> to choose one.',
      projects: ids.map((id) => ({ id, name: names.get(id) ?? null })),
    })
  }
  return getProjectInternal(ctx, only)
}

/** The agent's home project (the earliest project it was granted) and that grant's
 * scopes — what the agent's identity reports. Null if it has no project grant. */
export async function getAgentHomeProject(
  ctx: AppContext,
  agent: Agent,
): Promise<{ project: Project; scopes: AgentScope[] } | null> {
  const grants = await ctx.db
    .select()
    .from(agentGrants)
    .where(and(eq(agentGrants.agentId, agent.id), eq(agentGrants.resourceType, 'project')))
    .orderBy(agentGrants.createdAt)
  const home = grants[0]
  if (home === undefined) {
    return null
  }
  return { project: await getProjectInternal(ctx, home.resourceId), scopes: home.scopes }
}

/** Agents that hold a grant on a given project (caller must be a member of its org). */
export async function listAgents(ctx: AppContext, projectId: string, userId: string): Promise<AgentWithGrants[]> {
  await getProject(ctx, projectId, userId)
  const grantRows = await ctx.db
    .select({ agentId: agentGrants.agentId })
    .from(agentGrants)
    .where(and(eq(agentGrants.resourceType, 'project'), eq(agentGrants.resourceId, projectId)))
  const agentIds = [...new Set(grantRows.map((r) => r.agentId))]
  if (agentIds.length === 0) {
    return []
  }
  const rows = await ctx.db.select().from(agents).where(inArray(agents.id, agentIds)).orderBy(desc(agents.createdAt))
  const grants = await grantsByAgent(
    ctx,
    rows.map((a) => a.id),
  )
  return rows.map((agent) => ({ agent, grants: grants.get(agent.id) ?? [] }))
}

/** An org-wide agent row: the agent, its grants, and the name of its home project. */
export interface OrgAgentRow extends AgentWithGrants {
  projectName: string | null
}

/** Every agent in the organization (caller must be a member). */
export async function listOrgAgents(ctx: AppContext, orgId: string, userId: string): Promise<OrgAgentRow[]> {
  await assertOrgMember(ctx, orgId, userId)
  const rows = await ctx.db
    .select()
    .from(agents)
    .where(eq(agents.organizationId, orgId))
    .orderBy(desc(agents.createdAt))
  const grants = await grantsByAgent(
    ctx,
    rows.map((a) => a.id),
  )
  const projectIds = new Set<string>()
  for (const list of grants.values()) {
    for (const g of list) {
      if (g.resourceType === 'project') {
        projectIds.add(g.resourceId)
      }
    }
  }
  const names = await projectNames(ctx, [...projectIds])
  return rows.map((agent) => {
    const list = grants.get(agent.id) ?? []
    const home = list.filter((g) => g.resourceType === 'project').toSorted((a, b) => +a.createdAt - +b.createdAt)[0]
    return { agent, grants: list, projectName: home === undefined ? null : (names.get(home.resourceId) ?? null) }
  })
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

  // Provision the agent's restricted Postgres role for its home project up front; its
  // queries run over this connection, never the project owner connection.
  const { role, connectionUri } = await createAgentRole(project.connectionUri)

  const apiKey = newAgentKey()
  let result: AgentWithGrants
  try {
    result = await ctx.db.transaction(async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({
          organizationId: project.organizationId,
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
  // Confirm the caller is a member of the agent's organization.
  await assertOrgMember(ctx, row.organizationId, userId)
  const grants = await ctx.db.select().from(agentGrants).where(eq(agentGrants.agentId, id))
  return { agent: row, grants }
}

export async function deleteAgent(ctx: AppContext, id: string, userId: string): Promise<void> {
  const { agent, grants } = await getAgent(ctx, id, userId)
  for (const grant of grants) {
    if (grant.dbRole === null) {
      continue
    }
    // Each grant's role lives in its resource's database (a project/branch). Best-effort:
    // still remove the metadata row even if a teardown fails, matching deleteProject.
    // eslint-disable-next-line no-await-in-loop
    const ownerUri = await resourceConnectionUri(ctx, grant.resourceType, grant.resourceId).catch(() => null)
    if (ownerUri !== null) {
      // eslint-disable-next-line no-await-in-loop
      await dropAgentRole(ownerUri, grant.dbRole).catch((e) => {
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
 * Merge scopes into an agent's grant for a resource, validated and deduplicated, and
 * reconcile its Postgres role so the database engine enforces the result. Upserts: if the
 * agent has no grant on the resource yet, one (and its scoped role) is provisioned lazily.
 */
export async function grantScopes(
  ctx: AppContext,
  agentId: string,
  resourceType: GrantResourceType,
  resourceId: string,
  add: readonly AgentScope[],
): Promise<AgentGrant> {
  const ownerUri = await resourceConnectionUri(ctx, resourceType, resourceId)
  const existing = await getAgentGrant(ctx, agentId, resourceType, resourceId)

  if (existing !== undefined) {
    const merged = parseScopes([...existing.scopes, ...add])
    const [updated] = await ctx.db
      .update(agentGrants)
      .set({ scopes: merged })
      .where(eq(agentGrants.id, existing.id))
      .returning()
    const result = updated ?? existing
    if (result.dbRole !== null && ownerUri !== null) {
      await syncAgentScopes(ownerUri, result.dbRole, merged)
    }
    return result
  }

  // No grant yet: provision the grant (and, for resources with a database, a scoped role).
  const scopes = parseScopes([...add])
  if (ownerUri === null) {
    // Org-level grant: no database of its own, so no role to provision.
    const [created] = await ctx.db
      .insert(agentGrants)
      .values({ agentId, resourceType, resourceId, scopes, dbRole: null, connectionUri: null })
      .returning()
    if (created === undefined) {
      throw new HttpError(500, { error: 'internal_error', message: 'Failed to create agent grant.' })
    }
    return created
  }

  // Set the role up fully (create + sync) before writing the grant row, and roll it back on
  // any failure — so we never commit a grant whose role is missing/unsynced, nor leak a role
  // whose grant never landed (e.g. a concurrent first-grant race losing the unique check).
  const role = await createAgentRole(ownerUri)
  try {
    await syncAgentScopes(ownerUri, role.role, scopes)
    const [created] = await ctx.db
      .insert(agentGrants)
      .values({ agentId, resourceType, resourceId, scopes, dbRole: role.role, connectionUri: role.connectionUri })
      .returning()
    if (created === undefined) {
      throw new Error('Failed to insert agent grant row.')
    }
    return created
  } catch (err) {
    await rollbackAgentRole(ownerUri, role.role)
    throw err instanceof HttpError
      ? err
      : new HttpError(500, { error: 'internal_error', message: 'Failed to create agent grant.' })
  }
}
