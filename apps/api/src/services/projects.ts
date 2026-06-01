import { type ProvisionedDatabase, SYSTEM_USER_ID, setupProjectRoles } from '@walnut/core'
import { projects, type Project } from '@walnut/db'
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'

export async function listProjects(ctx: AppContext): Promise<Project[]> {
  return ctx.db
    .select()
    .from(projects)
    .where(eq(projects.userId, SYSTEM_USER_ID))
    .orderBy(desc(projects.createdAt))
}

/** Fetch a project by id with no ownership check (internal callers only). */
export async function getProjectInternal(ctx: AppContext, id: string): Promise<Project> {
  const [row] = await ctx.db.select().from(projects).where(eq(projects.id, id)).limit(1)
  if (row === undefined) {
    throw notFound('Project')
  }
  return row
}

export async function getProject(ctx: AppContext, id: string): Promise<Project> {
  const [row] = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, SYSTEM_USER_ID)))
    .limit(1)
  if (row === undefined) {
    throw notFound('Project')
  }
  return row
}

export async function createProject(ctx: AppContext, input: { name: string }): Promise<Project> {
  const [created] = await ctx.db
    .insert(projects)
    .values({
      userId: SYSTEM_USER_ID,
      name: input.name,
      provider: ctx.provider.kind,
      status: 'provisioning',
    })
    .returning()
  if (created === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create project.' })
  }

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

export async function deleteProject(ctx: AppContext, id: string): Promise<void> {
  const project = await getProject(ctx, id)
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
