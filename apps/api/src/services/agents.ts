import {
  type AgentScope,
  createAgentRole,
  dropAgentRole,
  effectiveScopes,
  hashKey,
  keyPrefix,
  newAgentKey,
  sameScopeSet,
  type ScopeWithExpiry,
  syncAgentScopes,
} from '@walnut/core'
import {
  agentGrants,
  agentGrantScopes,
  agents,
  branches,
  projects,
  type Agent,
  type AgentGrant,
  type GrantResourceType,
  type Project,
} from '@walnut/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { assertOrgMember } from './organizations.ts'
import { getProjectInternal, listProjectsInOrg } from './projects.ts'

/** A grant with its scope rows (each carrying an optional expiry) loaded in. The scopes
 * live in `agent_grant_scopes`; this is the joined shape the services and serializers
 * work with. */
export interface GrantWithScopes extends AgentGrant {
  scopes: ScopeWithExpiry[]
}

/** An agent plus its grants — the unit the dashboard and serializers care about. */
export interface AgentWithGrants {
  agent: Agent
  grants: GrantWithScopes[]
}

/** Attach each grant's scope rows (with expiry). Bulk-loads `agent_grant_scopes` for all
 * the given grants in one query, so callers never N+1 over grants. */
async function attachScopes(ctx: AppContext, grants: AgentGrant[]): Promise<GrantWithScopes[]> {
  if (grants.length === 0) {
    return []
  }
  const rows = await ctx.db
    .select()
    .from(agentGrantScopes)
    .where(inArray(agentGrantScopes.grantId, grants.map((g) => g.id)))
  const byGrant = new Map<string, ScopeWithExpiry[]>()
  for (const r of rows) {
    const list = byGrant.get(r.grantId) ?? []
    list.push({ scope: r.scope, expiresAt: r.expiresAt })
    byGrant.set(r.grantId, list)
  }
  return grants.map((g) => ({ ...g, scopes: byGrant.get(g.id) ?? [] }))
}

/** Load the grants for many agents at once, grouped by agent id (empty array if none). */
async function grantsByAgent(ctx: AppContext, agentIds: string[]): Promise<Map<string, GrantWithScopes[]>> {
  const byAgent = new Map<string, GrantWithScopes[]>(agentIds.map((id) => [id, []]))
  if (agentIds.length === 0) {
    return byAgent
  }
  const rows = await ctx.db.select().from(agentGrants).where(inArray(agentGrants.agentId, agentIds))
  for (const grant of await attachScopes(ctx, rows)) {
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
 * the agent's org). Otherwise default to the single project the agent has a grant on — and
 * if it has none yet, the org's sole project — so a freshly-created (grant-less) agent in a
 * one-project org still has an obvious target (a query there 403s for the missing scope; a
 * request lands on it). 0 or >1 candidates is an error the agent can act on (pass --project).
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
  let ids = await agentProjectIds(ctx, agent.id)
  if (ids.length === 0) {
    ids = (await listProjectsInOrg(ctx, agent.organizationId)).map((p) => p.id)
  }
  const only = ids[0]
  if (only === undefined) {
    throw new HttpError(400, {
      error: 'no_project',
      message: 'Agent has no project to target. Ask the user to create one (see `walnut project ls`).',
    })
  }
  if (ids.length > 1) {
    const names = await projectNames(ctx, ids)
    throw new HttpError(400, {
      error: 'ambiguous_project',
      message: 'Agent has several projects to choose from; pass --project <id>.',
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
  const [withScopes] = await attachScopes(ctx, [home])
  return {
    project: await getProjectInternal(ctx, home.resourceId),
    scopes: effectiveScopes(withScopes?.scopes ?? []),
  }
}

/** An org-wide agent row: the agent, its grants, and the names of the projects those
 * grants resolve to (keyed by resource id). */
export interface OrgAgentRow extends AgentWithGrants {
  projectNames: Record<string, string>
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
    const record: Record<string, string> = {}
    for (const g of list) {
      const name = names.get(g.resourceId)
      if (name !== undefined) {
        record[g.resourceId] = name
      }
    }
    return { agent, grants: list, projectNames: record }
  })
}

export interface CreatedAgent extends AgentWithGrants {
  /** Plaintext API key — returned only once, never persisted. */
  apiKey: string
}

export async function createAgent(
  ctx: AppContext,
  orgId: string,
  userId: string,
  input: { name: string },
): Promise<CreatedAgent> {
  await assertOrgMember(ctx, orgId, userId)
  // Born with zero grants and zero roles: an agent gets a scoped Postgres role only when
  // its first scope request on a resource is approved (see grantScopes).
  const apiKey = newAgentKey()
  const [agent] = await ctx.db
    .insert(agents)
    .values({
      organizationId: orgId,
      name: input.name,
      keyHash: hashKey(apiKey),
      keyPrefix: keyPrefix(apiKey),
    })
    .returning()
  if (agent === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create agent.' })
  }
  return { agent, grants: [], apiKey }
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
  return { agent: row, grants: await attachScopes(ctx, grants) }
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

/** The agent's grant for a given resource (its access there, with scope rows), if any. */
export async function getAgentGrant(
  ctx: AppContext,
  agentId: string,
  resourceType: GrantResourceType,
  resourceId: string,
): Promise<GrantWithScopes | undefined> {
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
  if (row === undefined) {
    return undefined
  }
  const [withScopes] = await attachScopes(ctx, [row])
  return withScopes
}

/**
 * Merge scopes (each with an optional expiry) into an agent's grant for a resource — a
 * **pure metadata write**, no Postgres role touched. The grant row is upserted if absent
 * and each scope is upserted into `agent_grant_scopes`, keeping the *later* expiry when a
 * scope is granted again (a `null`/permanent expiry always wins over a bounded one). The
 * Postgres role is reconciled lazily at query time by {@link ensureGrantSynced}, so the
 * metadata DB stays the single source of truth and approval can never half-fail across two
 * systems.
 */
export async function grantScopes(
  ctx: AppContext,
  agentId: string,
  resourceType: GrantResourceType,
  resourceId: string,
  add: readonly ScopeWithExpiry[],
): Promise<void> {
  if (add.length === 0) {
    return
  }
  const existing = await getAgentGrant(ctx, agentId, resourceType, resourceId)
  let grantId = existing?.id
  if (grantId === undefined) {
    const [created] = await ctx.db
      .insert(agentGrants)
      .values({ agentId, resourceType, resourceId })
      .onConflictDoNothing({ target: [agentGrants.agentId, agentGrants.resourceType, agentGrants.resourceId] })
      .returning({ id: agentGrants.id })
    grantId =
      created?.id ?? (await getAgentGrant(ctx, agentId, resourceType, resourceId))?.id
    if (grantId === undefined) {
      throw new HttpError(500, { error: 'internal_error', message: 'Failed to create agent grant.' })
    }
  }

  // Upsert each scope row. On conflict keep the longer-lived expiry: a NULL (permanent) on
  // either side wins; otherwise the later timestamp. This makes re-granting an expired or
  // shorter-lived scope simply extend it, never shorten existing access.
  await ctx.db
    .insert(agentGrantScopes)
    .values(add.map((e) => ({ grantId, scope: e.scope, expiresAt: e.expiresAt })))
    .onConflictDoUpdate({
      target: [agentGrantScopes.grantId, agentGrantScopes.scope],
      set: {
        expiresAt: sql`CASE
          WHEN excluded.expires_at IS NULL OR ${agentGrantScopes.expiresAt} IS NULL THEN NULL
          ELSE GREATEST(${agentGrantScopes.expiresAt}, excluded.expires_at)
        END`,
      },
    })
}

/**
 * Reconcile the grant's Postgres role to match its current *effective* scopes, then return
 * the connection to run the query over. This is the reconcile-on-read step: the metadata DB
 * is authoritative, the role is a cache refreshed before use.
 *
 * Fast path: if the role exists and its `syncedScopes` snapshot already equals the effective
 * set, no role DDL happens at all — the common case. Slow path: lazily create the role on the
 * resource's database the first time (serialized with a row lock so concurrent first-queries
 * don't double-create), `GRANT`/`REVOKE` group memberships to match, and persist the snapshot.
 * A scope that just lapsed is dropped from `effective` here, so the next query revokes it.
 */
export async function ensureGrantSynced(
  ctx: AppContext,
  grant: GrantWithScopes,
  ownerUri: string | null,
  now: Date = new Date(),
): Promise<{ connectionUri: string | null; effective: AgentScope[] }> {
  const effective = effectiveScopes(grant.scopes, now)
  // Org-level grants have no database of their own — nothing to provision or sync.
  if (ownerUri === null) {
    return { connectionUri: null, effective }
  }
  // Fast path: role provisioned and snapshot already matches → skip all role DDL.
  if (grant.dbRole !== null && grant.connectionUri !== null && sameScopeSet(grant.syncedScopes, effective)) {
    return { connectionUri: grant.connectionUri, effective }
  }

  // First query on this resource: create the role under a row lock so two concurrent
  // first-queries can't each create one (and orphan a role). The lock serializes the
  // create+sync; a loser sees the winner's `dbRole` and reuses it.
  if (grant.dbRole === null || grant.connectionUri === null) {
    return ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(agentGrants).where(eq(agentGrants.id, grant.id)).for('update')
      let dbRole = locked?.dbRole ?? null
      let connectionUri = locked?.connectionUri ?? null
      let createdRole: string | null = null
      if (dbRole === null || connectionUri === null) {
        const role = await createAgentRole(ownerUri)
        dbRole = role.role
        connectionUri = role.connectionUri
        createdRole = role.role
      }
      try {
        await syncAgentScopes(ownerUri, dbRole, effective)
        await tx
          .update(agentGrants)
          .set({ dbRole, connectionUri, syncedScopes: effective })
          .where(eq(agentGrants.id, grant.id))
      } catch (err) {
        if (createdRole !== null) {
          await rollbackAgentRole(ownerUri, createdRole)
        }
        throw err
      }
      return { connectionUri, effective }
    })
  }

  // Role exists but its memberships drifted from effective (a scope was granted or expired).
  // GRANT/REVOKE is idempotent, so concurrent reconciles to the same set are harmless.
  await syncAgentScopes(ownerUri, grant.dbRole, effective)
  await ctx.db.update(agentGrants).set({ syncedScopes: effective }).where(eq(agentGrants.id, grant.id))
  return { connectionUri: grant.connectionUri, effective }
}
