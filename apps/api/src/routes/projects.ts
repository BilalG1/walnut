import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import {
  toActivityEventView,
  toBranchDetail,
  toBranchView,
  toProjectDetail,
  toProjectSummary,
} from '../serializers.ts'
import { listProjectActivity } from '../services/activity.ts'
import {
  createBranch,
  createProject,
  deleteBranch,
  deleteProject,
  getDefaultBranch,
  getProject,
  listBranches,
  listProjects,
  resolveBranch,
} from '../services/projects.ts'
import { runReadOnlyQuery } from '../services/query.ts'
import {
  commitUpload,
  createUpload,
  deleteObject,
  downloadObject,
  listStorageObjects,
  statObject,
} from '../services/storage.ts'
import { idParams, nameSchema, uuid } from '../validation.ts'

// The branch segment is a plain name (a `text` column), so it stays an unconstrained string;
// only the project `:id` is validated as a UUID (see validation.ts).
const branchParams = t.Object({ id: uuid, branch: t.String() })

/** Body for the read-only data-viewer SQL routes: a statement plus positional params. Scalars
 * (bound to `$n`) plus arrays (for `= ANY($n)`); deliberately not bare objects. */
const sqlBody = t.Object({
  sql: t.String({ minLength: 1 }),
  params: t.Optional(t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null(), t.Array(t.Unknown())]))),
})

export function projectRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/projects' })
    .resolve(async ({ headers, set }) => {
      const auth = await authenticate(ctx, headers.authorization)
      set.headers['cache-control'] = 'private, no-store'
      return auth
    })
    .get('/', async ({ userId }) => {
      const rows = await listProjects(ctx, userId)
      return rows.map(toProjectSummary)
    })
    .post(
      '/',
      async ({ userId, body }) => {
        const project = await createProject(ctx, userId, body)
        const main = await getDefaultBranch(ctx, project.id)
        return toProjectDetail(project, main.connectionUri)
      },
      { body: t.Object({ name: nameSchema }) },
    )
    .get(
      '/:id',
      async ({ userId, params }) => {
        const project = await getProject(ctx, params.id, userId)
        const main = await getDefaultBranch(ctx, project.id)
        return toProjectDetail(project, main.connectionUri)
      },
      { params: idParams },
    )
    .delete(
      '/:id',
      async ({ userId, params }) => {
        await deleteProject(ctx, params.id, userId)
        return { deleted: true }
      },
      { params: idParams },
    )
    .get(
      '/:id/branches',
      async ({ userId, params }) => {
        const rows = await listBranches(ctx, params.id, userId)
        return rows.map(toBranchView)
      },
      { params: idParams },
    )
    .post(
      '/:id/branches',
      async ({ userId, params, body }) => toBranchView(await createBranch(ctx, params.id, userId, body)),
      { params: idParams, body: t.Object({ name: nameSchema, from: t.Optional(t.String({ maxLength: 64 })) }) },
    )
    .get(
      '/:id/branches/:branch',
      async ({ userId, params }) => {
        await getProject(ctx, params.id, userId)
        return toBranchDetail(await resolveBranch(ctx, params.id, params.branch))
      },
      { params: branchParams },
    )
    .delete(
      '/:id/branches/:branch',
      async ({ userId, params }) => {
        await deleteBranch(ctx, params.id, params.branch, userId)
        return { deleted: true }
      },
      { params: branchParams },
    )
    .get(
      '/:id/activity',
      async ({ userId, params, query }) => {
        const rows = await listProjectActivity(ctx, params.id, userId, { branch: query.branch })
        return rows.map((r) => toActivityEventView(r.event, r.agentName, r.branchName))
      },
      { params: idParams, query: t.Object({ branch: t.Optional(t.String()) }) },
    )
    // Read-only SQL for the dashboard data viewer. The `@walnut/db-viewer` Postgres adapter
    // (running in the browser) posts parameterized statements here. Two layers keep it read-only
    // over the branch's owner connection: the SQL classifier gates each statement to db:read (a
    // clear 403 for writes), and the query runs in a read-only transaction so the engine refuses
    // anything the classifier might miss. `/:id/sql` targets the default branch; the
    // branch-qualified route targets a specific branch.
    .post(
      '/:id/sql',
      async ({ userId, params, body }) => {
        await getProject(ctx, params.id, userId)
        const main = await getDefaultBranch(ctx, params.id)
        return runReadOnlyQuery(main, body.sql, body.params ?? [])
      },
      { params: idParams, body: sqlBody },
    )
    .post(
      '/:id/branches/:branch/sql',
      async ({ userId, params, body }) => {
        await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return runReadOnlyQuery(branch, body.sql, body.params ?? [])
      },
      { params: branchParams, body: sqlBody },
    )
    // ─── Per-branch object storage (the dashboard storage browser) ──────────────────────────────
    // The same storage service the agent API uses, but authorized by org membership (getProject)
    // instead of an agent's storage scopes — the dashboard is the human oversight surface. Reads
    // resolve the branch's effective (nearest-ancestor-wins) view; up/downloads go through
    // short-TTL presigned URLs so bytes never transit the API (the browser hashes the file and
    // runs the same two-phase write as the CLI).
    .get(
      '/:id/branches/:branch/storage/ls',
      async ({ userId, params, query }) => {
        await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return listStorageObjects(ctx, branch, { prefix: query.prefix, after: query.after, limit: query.limit })
      },
      {
        params: branchParams,
        query: t.Object({
          prefix: t.Optional(t.String()),
          after: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1 })),
        }),
      },
    )
    .get(
      '/:id/branches/:branch/storage/stat',
      async ({ userId, params, query }) => {
        await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return statObject(ctx, branch, query.path)
      },
      { params: branchParams, query: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
    .get(
      '/:id/branches/:branch/storage/download',
      async ({ userId, params, query }) => {
        await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return downloadObject(ctx, branch, query.path)
      },
      { params: branchParams, query: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
    .post(
      '/:id/branches/:branch/storage/upload',
      async ({ userId, params, body }) => {
        const project = await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return createUpload(ctx, project, branch, {
          path: body.path,
          sha256: body.sha256,
          size: body.size,
          contentType: body.contentType,
        })
      },
      {
        params: branchParams,
        body: t.Object({
          path: t.String({ minLength: 1 }),
          sha256: t.String(),
          size: t.Integer({ minimum: 0 }),
          contentType: t.Optional(t.String({ maxLength: 255 })),
        }),
      },
    )
    .post(
      '/:id/branches/:branch/storage/commit',
      async ({ userId, params, body }) => {
        await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return commitUpload(ctx, branch, { path: body.path })
      },
      { params: branchParams, body: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
    .post(
      '/:id/branches/:branch/storage/delete',
      async ({ userId, params, body }) => {
        await getProject(ctx, params.id, userId)
        const branch = await resolveBranch(ctx, params.id, params.branch)
        return deleteObject(ctx, branch, { path: body.path })
      },
      { params: branchParams, body: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
}
