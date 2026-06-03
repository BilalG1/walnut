import { type ProvisionedProject, setupProjectRoles } from '@walnut/core'
import { agentGrants, branches, organizationMembers, projects, scopeRequests, type Branch, type Project } from '@walnut/db'
import { and, count, desc, eq, inArray, or } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { assertOrgMember, getDefaultOrgId } from './organizations.ts'

/** A user's projects: those in any organization they're a member of. */
export async function listProjects(ctx: AppContext, userId: string): Promise<Project[]> {
  const rows = await ctx.db
    .select({ project: projects })
    .from(projects)
    .innerJoin(organizationMembers, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(desc(projects.createdAt))
  return rows.map((r) => r.project)
}

/** A project plus the at-a-glance counts the org home shows on each card. */
export interface OrgProjectRow {
  project: Project
  agentCount: number
  pendingRequestCount: number
  defaultBranch: string | null
}

/** Projects in one organization (caller must be a member), with per-project counts. */
export async function listOrgProjects(ctx: AppContext, orgId: string, userId: string): Promise<OrgProjectRow[]> {
  await assertOrgMember(ctx, orgId, userId)
  const rows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.organizationId, orgId))
    .orderBy(desc(projects.createdAt))
  if (rows.length === 0) {
    return []
  }
  const ids = rows.map((p) => p.id)

  // "Agents on a project" = distinct agents holding a project grant on it (an agent is
  // org-scoped, so it counts toward every project it has been granted access to).
  const agentGrantRows = await ctx.db
    .select({ resourceId: agentGrants.resourceId, agentId: agentGrants.agentId })
    .from(agentGrants)
    .where(and(eq(agentGrants.resourceType, 'project'), inArray(agentGrants.resourceId, ids)))
  const pendingCounts = await ctx.db
    .select({ resourceId: scopeRequests.resourceId, n: count() })
    .from(scopeRequests)
    .where(
      and(
        eq(scopeRequests.resourceType, 'project'),
        inArray(scopeRequests.resourceId, ids),
        eq(scopeRequests.status, 'pending'),
      ),
    )
    .groupBy(scopeRequests.resourceId)
  const defaultBranches = await ctx.db
    .select({ projectId: branches.projectId, name: branches.name })
    .from(branches)
    .where(and(inArray(branches.projectId, ids), eq(branches.isDefault, true)))

  const agentsByProject = new Map<string, Set<string>>()
  for (const r of agentGrantRows) {
    let set = agentsByProject.get(r.resourceId)
    if (set === undefined) {
      set = new Set()
      agentsByProject.set(r.resourceId, set)
    }
    set.add(r.agentId)
  }
  const pendingByProject = new Map(pendingCounts.map((r) => [r.resourceId, Number(r.n)]))
  const branchByProject = new Map(defaultBranches.map((r) => [r.projectId, r.name]))

  return rows.map((project) => ({
    project,
    agentCount: agentsByProject.get(project.id)?.size ?? 0,
    pendingRequestCount: pendingByProject.get(project.id) ?? 0,
    defaultBranch: branchByProject.get(project.id) ?? null,
  }))
}

/** Every project in an org, newest first. No membership check — for agent callers that
 * are already authenticated and bound to the org. */
export async function listProjectsInOrg(ctx: AppContext, orgId: string): Promise<Project[]> {
  return ctx.db.select().from(projects).where(eq(projects.organizationId, orgId)).orderBy(desc(projects.createdAt))
}

/** A project's default (`main`) branch. Throws if the project has none (shouldn't happen —
 * every project is created with one). */
export async function getDefaultBranch(ctx: AppContext, projectId: string): Promise<Branch> {
  const [row] = await ctx.db
    .select()
    .from(branches)
    .where(and(eq(branches.projectId, projectId), eq(branches.isDefault, true)))
    .limit(1)
  if (row === undefined) {
    throw notFound('Branch')
  }
  return row
}

/** Resolve a query/grant target branch: the named branch, or the project's default when no
 * name is given. A named branch that doesn't exist is a clear 404 the agent can act on. */
export async function resolveBranch(ctx: AppContext, projectId: string, name?: string): Promise<Branch> {
  if (name === undefined) {
    return getDefaultBranch(ctx, projectId)
  }
  const [row] = await ctx.db
    .select()
    .from(branches)
    .where(and(eq(branches.projectId, projectId), eq(branches.name, name)))
    .limit(1)
  if (row === undefined) {
    throw new HttpError(404, { error: 'branch_not_found', message: `No branch "${name}" on this project.` })
  }
  return row
}

/** A project's branches (caller must be a member of its org). Default branch first. */
export async function listBranches(ctx: AppContext, projectId: string, userId: string): Promise<Branch[]> {
  await getProject(ctx, projectId, userId)
  return ctx.db
    .select()
    .from(branches)
    .where(eq(branches.projectId, projectId))
    .orderBy(desc(branches.isDefault), branches.name)
}

/** Fetch a project by id with no ownership check (internal/agent callers only). */
export async function getProjectInternal(ctx: AppContext, id: string): Promise<Project> {
  const [row] = await ctx.db.select().from(projects).where(eq(projects.id, id)).limit(1)
  if (row === undefined) {
    throw notFound('Project')
  }
  return row
}

/** Fetch a project the user can access (member of its org), else 404. */
export async function getProject(ctx: AppContext, id: string, userId: string): Promise<Project> {
  const [row] = await ctx.db
    .select({ project: projects })
    .from(projects)
    .innerJoin(organizationMembers, eq(projects.organizationId, organizationMembers.organizationId))
    .where(and(eq(projects.id, id), eq(organizationMembers.userId, userId)))
    .limit(1)
  if (row === undefined) {
    throw notFound('Project')
  }
  return row.project
}

export async function createProject(
  ctx: AppContext,
  userId: string,
  input: { name: string },
  orgId?: string,
): Promise<Project> {
  // Create in the requested org (membership-checked) or fall back to the personal org.
  let organizationId: string
  if (orgId === undefined) {
    organizationId = await getDefaultOrgId(ctx, userId)
  } else {
    await assertOrgMember(ctx, orgId, userId)
    organizationId = orgId
  }
  const [created] = await ctx.db
    .insert(projects)
    .values({
      organizationId,
      name: input.name,
      provider: ctx.provider.kind,
      status: 'provisioning',
    })
    .returning()
  if (created === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create project.' })
  }

  // Every project starts with a `main` branch — the branch *is* the database, so it carries
  // the connection/roles. It starts provisioning and flips to active alongside the project.
  const [mainBranch] = await ctx.db
    .insert(branches)
    .values({ projectId: created.id, name: 'main', isDefault: true, status: 'provisioning' })
    .returning()
  if (mainBranch === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create main branch.' })
  }

  let provisioned: ProvisionedProject | undefined
  try {
    provisioned = await ctx.provider.provisionProject({ name: input.name })
    const { defaultBranch } = provisioned
    // Establish the per-scope group roles before the database is used, so every agent
    // connection is enforced by the engine and not just the SQL classifier.
    await setupProjectRoles(defaultBranch.connectionUri)
    await ctx.db
      .update(branches)
      .set({
        status: 'active',
        providerBranchId: defaultBranch.providerBranchId,
        connectionUri: defaultBranch.connectionUri,
        region: defaultBranch.region,
      })
      .where(eq(branches.id, mainBranch.id))
    const [updated] = await ctx.db
      .update(projects)
      .set({ status: 'active', providerProjectId: provisioned.providerProjectId })
      .where(eq(projects.id, created.id))
      .returning()
    return updated ?? created
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown provisioning error'
    // If the database was created but a later step failed, tear it down so we don't leak an
    // orphaned database. A container provider (Neon) is torn down whole; a flat provider (local)
    // by its branch database.
    if (provisioned !== undefined) {
      await teardownProvider(ctx, provisioned.providerProjectId, [provisioned.defaultBranch.providerBranchId]).catch(
        (e) => console.error(`Failed to clean up orphaned database for project ${created.id}:`, e),
      )
    }
    await ctx.db.update(projects).set({ status: 'error', error: message }).where(eq(projects.id, created.id))
    await ctx.db.update(branches).set({ status: 'error', error: message }).where(eq(branches.id, mainBranch.id))
    throw new HttpError(502, {
      error: 'provisioning_failed',
      message: `Failed to provision database: ${message}`,
    })
  }
}

/**
 * Tear down a project's provider-side databases. A container provider (Neon, `providerProjectId`
 * set) is destroyed whole — one call removes every branch. A flat provider (local) has no
 * container, so each branch database is destroyed individually. `branchIds` are the provider
 * branch ids to drop in the flat case (ignored when there's a container).
 */
async function teardownProvider(
  ctx: AppContext,
  providerProjectId: string | null,
  branchProviderIds: readonly (string | null)[],
): Promise<void> {
  if (providerProjectId !== null) {
    await ctx.provider.destroyProject(providerProjectId)
    return
  }
  for (const providerBranchId of branchProviderIds) {
    if (providerBranchId === null) {
      continue
    }
    // Sequential by design: one branch teardown at a time over the admin connection.
    // eslint-disable-next-line no-await-in-loop
    await ctx.provider.destroyBranch({ providerProjectId, providerBranchId })
  }
}

export async function deleteProject(ctx: AppContext, id: string, userId: string): Promise<void> {
  const project = await getProject(ctx, id, userId)
  const projBranches = await ctx.db
    .select({ id: branches.id, providerBranchId: branches.providerBranchId })
    .from(branches)
    .where(eq(branches.projectId, id))
  try {
    await teardownProvider(
      ctx,
      project.providerProjectId,
      projBranches.map((b) => b.providerBranchId),
    )
  } catch (err) {
    // Best-effort: drop the metadata rows even if the provider teardown fails.
    console.error(`Failed to destroy provider databases for project ${id}:`, err)
  }
  // agent_grants / scope_requests reference resources polymorphically (no FK cascade), so
  // clear the rows anchored to this project and its branches before dropping it. Agents are
  // org-scoped and survive — they simply lose their access to this project. (branch_db_roles
  // rows cascade with the branches.)
  const branchIds = projBranches.map((b) => b.id)
  await ctx.db
    .delete(agentGrants)
    .where(
      or(
        and(eq(agentGrants.resourceType, 'project'), eq(agentGrants.resourceId, id)),
        branchIds.length > 0
          ? and(eq(agentGrants.resourceType, 'branch'), inArray(agentGrants.resourceId, branchIds))
          : undefined,
      ),
    )
  await ctx.db
    .delete(scopeRequests)
    .where(
      or(
        and(eq(scopeRequests.resourceType, 'project'), eq(scopeRequests.resourceId, id)),
        branchIds.length > 0
          ? and(eq(scopeRequests.resourceType, 'branch'), inArray(scopeRequests.resourceId, branchIds))
          : undefined,
      ),
    )
  await ctx.db.delete(projects).where(eq(projects.id, id))
}
