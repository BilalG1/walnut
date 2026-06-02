import { type ProvisionedDatabase, setupProjectRoles } from '@walnut/core'
import { branches, organizationMembers, projects, type Project } from '@walnut/db'
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { getDefaultOrgId } from './organizations.ts'

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
): Promise<Project> {
  const organizationId = await getDefaultOrgId(ctx, userId)
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

  // Every project starts with a `main` branch. Inert metadata today (it *is* the
  // project's database); real per-branch databases land later.
  await ctx.db.insert(branches).values({ projectId: created.id, name: 'main', isDefault: true })

  let provisioned: ProvisionedDatabase | undefined
  try {
    provisioned = await ctx.provider.provision({ name: input.name })
    // Establish the per-scope group roles before the database is used, so every
    // agent connection is enforced by the engine and not just the SQL classifier.
    await setupProjectRoles(provisioned.connectionUri)
    const [updated] = await ctx.db
      .update(projects)
      .set({
        status: 'active',
        providerProjectId: provisioned.providerProjectId,
        connectionUri: provisioned.connectionUri,
        region: provisioned.region,
      })
      .where(eq(projects.id, created.id))
      .returning()
    return updated ?? created
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown provisioning error'
    // If the database was created but a later step failed, tear it down so we don't
    // leak an orphaned database (its metadata row never records providerProjectId).
    if (provisioned !== undefined) {
      await ctx.provider
        .destroy(provisioned.providerProjectId)
        .catch((e) => console.error(`Failed to clean up orphaned database for project ${created.id}:`, e))
    }
    await ctx.db.update(projects).set({ status: 'error', error: message }).where(eq(projects.id, created.id))
    throw new HttpError(502, {
      error: 'provisioning_failed',
      message: `Failed to provision database: ${message}`,
    })
  }
}

export async function deleteProject(ctx: AppContext, id: string, userId: string): Promise<void> {
  const project = await getProject(ctx, id, userId)
  if (project.providerProjectId !== null) {
    try {
      await ctx.provider.destroy(project.providerProjectId)
    } catch (err) {
      // Best-effort: drop the metadata row even if the provider teardown fails.
      console.error(`Failed to destroy provider database for project ${id}:`, err)
    }
  }
  await ctx.db.delete(projects).where(eq(projects.id, id))
}
