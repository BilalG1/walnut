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
import { uuid } from '../validation.ts'

const nameSchema = t.String({ minLength: 1, maxLength: 64 })

// Path-param schemas: validate the project id as a UUID before it reaches the DB (a non-UUID
// would otherwise fail the Postgres `uuid` cast as an opaque 500). The branch segment is a
// plain name (a `text` column), so it stays an unconstrained string.
const idParams = t.Object({ id: uuid })
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
}
