import {
  type AgentScope,
  effectiveScopes,
  ensureScopeRole,
  hashKey,
  isAgentScope,
  keyPrefix,
  newAgentKey,
  RESOURCE_LIMITS,
  scopeSetKey,
  type ScopeWithExpiry,
} from '@walnut/core'
import {
  agentGrants,
  agentGrantScopes,
  agents,
  branchDbRoles,
  branches,
  projects,
  type Agent,
  type AgentGrant,
  type Branch,
  type GrantResourceType,
  type Project,
} from '@walnut/db'
import { and, count, desc, eq, inArray, notExists, or, sql } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, limitExceeded, notFound } from '../errors.ts'
import { enforceRate } from '../rate-limit.ts'
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

/** A display label for each grant's resource, keyed by resourceId: project grants → the project
 * name; branch grants → `"<project> / <branch>"`. Org grants carry no database scopes (so they
 * never surface on the detail page) and are skipped. Bulk-loads to avoid N+1 over grants. */
async function resourceNamesForGrants(ctx: AppContext, grants: AgentGrant[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {}
  const projectIds = grants.filter((g) => g.resourceType === 'project').map((g) => g.resourceId)
  const branchIds = grants.filter((g) => g.resourceType === 'branch').map((g) => g.resourceId)
  if (projectIds.length > 0) {
    for (const [id, name] of await projectNames(ctx, projectIds)) {
      names[id] = name
    }
  }
  if (branchIds.length > 0) {
    const rows = await ctx.db
      .select({ id: branches.id, branch: branches.name, project: projects.name })
      .from(branches)
      .innerJoin(projects, eq(branches.projectId, projects.id))
      .where(inArray(branches.id, branchIds))
    for (const r of rows) {
      names[r.id] = `${r.project} / ${r.branch}`
    }
  }
  return names
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
  // Cap agents per org. Cheap (pure metadata) but bounds API-key sprawl.
  const [{ n: agentCount } = { n: 0 }] = await ctx.db
    .select({ n: count() })
    .from(agents)
    .where(eq(agents.organizationId, orgId))
  if (agentCount >= RESOURCE_LIMITS.agentsPerOrg) {
    throw limitExceeded(`This organization has reached its limit of ${RESOURCE_LIMITS.agentsPerOrg} agents.`, {
      limit: 'agents_per_org',
      max: RESOURCE_LIMITS.agentsPerOrg,
      scope: 'org',
    })
  }
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

/**
 * Mint a fresh API key for an existing agent, invalidating the old one (only the hash is
 * stored, so a lost key can never be re-shown — it must be rotated). Grants and Postgres
 * roles are unaffected; the new key authenticates as the same agent. Used by the
 * onboarding wizard to recover a key after a reload, where the plaintext was never
 * persisted client-side.
 */
export async function rotateAgentKey(
  ctx: AppContext,
  agentId: string,
  userId: string,
): Promise<CreatedAgent> {
  // Membership is checked first (getAgent) so the per-agent bucket can't be griefed by a
  // non-owner; only authorized rotations count against it.
  const { agent, grants } = await getAgent(ctx, agentId, userId)
  enforceRate(ctx.rateLimiter, 'keyRotationPerAgent', agentId)
  const apiKey = newAgentKey()
  const [updated] = await ctx.db
    .update(agents)
    .set({ keyHash: hashKey(apiKey), keyPrefix: keyPrefix(apiKey) })
    .where(eq(agents.id, agent.id))
    .returning()
  if (updated === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to rotate agent key.' })
  }
  return { agent: updated, grants, apiKey }
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
  const { agent } = await getAgent(ctx, id, userId)
  // Nothing to tear down at the engine: scope roles are shared per database (keyed by scope
  // set, not agent) and outlive any single agent. Cascade removes the agent's grant + scope rows.
  await ctx.db.delete(agents).where(eq(agents.id, agent.id))
}

/** An agent, its grants, and a resourceId→label map for those grants — what the agent detail /
 * management page renders. */
export interface AgentDetail extends AgentWithGrants {
  resourceNames: Record<string, string>
}

export async function getAgentDetail(ctx: AppContext, id: string, userId: string): Promise<AgentDetail> {
  const { agent, grants } = await getAgent(ctx, id, userId)
  return { agent, grants, resourceNames: await resourceNamesForGrants(ctx, grants) }
}

/** Load an agent's grant by id, asserting it belongs to `agentId` (and, via getAgent, that the
 * agent is in the caller's org). 404 otherwise — no existence leak across agents or orgs. */
async function getOwnedGrant(ctx: AppContext, agentId: string, grantId: string, userId: string): Promise<AgentGrant> {
  await getAgent(ctx, agentId, userId)
  const [grant] = await ctx.db.select().from(agentGrants).where(eq(agentGrants.id, grantId)).limit(1)
  if (grant === undefined || grant.agentId !== agentId) {
    throw notFound('Grant')
  }
  return grant
}

/**
 * Revoke an agent's entire grant on a resource: delete the grant row, cascading its scope rows.
 * A **pure metadata delete** — the mirror of {@link grantScopes}. No Postgres role is touched;
 * the agent's next query on that resource simply resolves to a lesser (or no) scoped connection.
 */
export async function revokeGrant(ctx: AppContext, agentId: string, grantId: string, userId: string): Promise<void> {
  const grant = await getOwnedGrant(ctx, agentId, grantId, userId)
  await ctx.db.delete(agentGrants).where(eq(agentGrants.id, grant.id))
}

/**
 * Revoke a single scope from an agent's grant. Deletes that scope row; if it was the grant's
 * last scope, the now-empty grant row is removed too (no dangling no-access grants). Pure
 * metadata delete, like {@link revokeGrant}. 404 if the scope isn't held on the grant.
 */
export async function revokeGrantScope(
  ctx: AppContext,
  agentId: string,
  grantId: string,
  scope: string,
  userId: string,
): Promise<void> {
  const grant = await getOwnedGrant(ctx, agentId, grantId, userId)
  if (!isAgentScope(scope)) {
    throw notFound('Scope')
  }
  // Delete the scope row, then drop the grant iff that left it empty — both in one transaction,
  // and the grant-delete is a single conditional statement (no select-then-delete window) so a
  // concurrent re-grant of another scope can't be clobbered.
  await ctx.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(agentGrantScopes)
      .where(and(eq(agentGrantScopes.grantId, grant.id), eq(agentGrantScopes.scope, scope)))
      .returning({ id: agentGrantScopes.id })
    if (deleted.length === 0) {
      throw notFound('Scope')
    }
    await tx.delete(agentGrants).where(
      and(
        eq(agentGrants.id, grant.id),
        notExists(tx.select({ one: sql`1` }).from(agentGrantScopes).where(eq(agentGrantScopes.grantId, grant.id))),
      ),
    )
  })
}

export async function findAgentByKey(ctx: AppContext, key: string): Promise<Agent | undefined> {
  const [row] = await ctx.db.select().from(agents).where(eq(agents.keyHash, hashKey(key))).limit(1)
  return row
}

/**
 * The scope rows that govern an agent on a specific branch — the union of its grants on that
 * branch and on the parent project (the resource chain). A grant anchored to the project applies
 * to every branch; a grant anchored to the branch adds to it. Org grants carry no database scopes
 * (SCOPES_BY_RESOURCE.org is empty) so they never affect a database connection and are omitted.
 * Returned as raw rows (with expiry) so the caller applies expiry at query time.
 */
export async function agentScopesForBranch(
  ctx: AppContext,
  agentId: string,
  projectId: string,
  branchId: string,
): Promise<ScopeWithExpiry[]> {
  const grants = await ctx.db
    .select()
    .from(agentGrants)
    .where(
      and(
        eq(agentGrants.agentId, agentId),
        or(
          and(eq(agentGrants.resourceType, 'project'), eq(agentGrants.resourceId, projectId)),
          and(eq(agentGrants.resourceType, 'branch'), eq(agentGrants.resourceId, branchId)),
        ),
      ),
    )
  const withScopes = await attachScopes(ctx, grants)
  return withScopes.flatMap((g) => g.scopes)
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
 * scope is granted again (a `null`/permanent expiry always wins over a bounded one). No
 * Postgres role is touched: queries select a shared scoped connection by scope set at query
 * time ({@link connectionForScopes}), so the metadata DB stays the single source of truth and
 * approval can never half-fail across two systems.
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
 * The connection an agent's query should run over, given its current *effective* scopes on a
 * branch's database. Enforcement is by scope set, not by agent: this resolves (lazily
 * provisioning on first use) the shared scoped role for that set on that branch and returns its
 * connection.
 *
 * Returns `null` when there's nothing to run as — no database scopes in the set (`scopeKey`
 * `'0'`), or the branch has no connection yet. Fast path: a cached `branch_db_roles` row for
 * the scope set returns immediately. Slow path: under a row lock on the branch (so concurrent
 * first-uses of the same set don't double-provision), re-check, then {@link ensureScopeRole}
 * and cache the row. The role itself is idempotent, so this is safe to retry.
 */
export async function connectionForScopes(
  ctx: AppContext,
  branch: Branch,
  scopes: readonly AgentScope[],
): Promise<string | null> {
  const key = scopeSetKey(scopes)
  const ownerUri = branch.connectionUri
  if (key === '0' || ownerUri === null) {
    return null
  }
  const [existing] = await ctx.db
    .select({ connectionUri: branchDbRoles.connectionUri })
    .from(branchDbRoles)
    .where(and(eq(branchDbRoles.branchId, branch.id), eq(branchDbRoles.scopeKey, key)))
    .limit(1)
  if (existing !== undefined) {
    return existing.connectionUri
  }

  return ctx.db.transaction(async (tx) => {
    // Lock the branch row so two concurrent first-uses of this scope set serialize; the loser
    // sees the winner's cached row on re-check rather than provisioning a second time.
    await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branch.id)).for('update')
    const [again] = await tx
      .select({ connectionUri: branchDbRoles.connectionUri })
      .from(branchDbRoles)
      .where(and(eq(branchDbRoles.branchId, branch.id), eq(branchDbRoles.scopeKey, key)))
      .limit(1)
    if (again !== undefined) {
      return again.connectionUri
    }
    const { role, connectionUri } = await ensureScopeRole(ownerUri, scopes)
    await tx
      .insert(branchDbRoles)
      .values({ branchId: branch.id, scopeKey: key, dbRole: role, connectionUri })
      .onConflictDoNothing({ target: [branchDbRoles.branchId, branchDbRoles.scopeKey] })
    const [stored] = await tx
      .select({ connectionUri: branchDbRoles.connectionUri })
      .from(branchDbRoles)
      .where(and(eq(branchDbRoles.branchId, branch.id), eq(branchDbRoles.scopeKey, key)))
      .limit(1)
    return stored?.connectionUri ?? connectionUri
  })
}
