import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toActivityEventView, toBranchView, toProjectDetail, toProjectSummary } from '../serializers.ts'
import { listProjectActivity } from '../services/activity.ts'
import {
  createProject,
  deleteProject,
  getDefaultBranch,
  getProject,
  listBranches,
  listProjects,
} from '../services/projects.ts'
import { runReadOnlyQuery } from '../services/query.ts'

const nameSchema = t.String({ minLength: 1, maxLength: 64 })

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
    .get('/:id', async ({ userId, params }) => {
      const project = await getProject(ctx, params.id, userId)
      const main = await getDefaultBranch(ctx, project.id)
      return toProjectDetail(project, main.connectionUri)
    })
    .delete('/:id', async ({ userId, params }) => {
      await deleteProject(ctx, params.id, userId)
      return { deleted: true }
    })
    .get('/:id/branches', async ({ userId, params }) => {
      const rows = await listBranches(ctx, params.id, userId)
      return rows.map(toBranchView)
    })
    .get('/:id/activity', async ({ userId, params }) => {
      const rows = await listProjectActivity(ctx, params.id, userId)
      return rows.map((r) => toActivityEventView(r.event, r.agentName))
    })
    // Read-only SQL for the dashboard data viewer. The `@walnut/db-viewer` Postgres adapter
    // (running in the browser) posts parameterized statements here. Two layers keep it read-only
    // over the owner connection: the SQL classifier gates each statement to db:read (a clear 403
    // for writes), and the query runs in a read-only transaction so the engine refuses anything
    // the classifier might miss.
    .post(
      '/:id/sql',
      async ({ userId, params, body }) => {
        // Membership check, then run over the default branch's database (the one the viewer shows).
        await getProject(ctx, params.id, userId)
        const main = await getDefaultBranch(ctx, params.id)
        return runReadOnlyQuery(main, body.sql, body.params ?? [])
      },
      {
        body: t.Object({
          sql: t.String({ minLength: 1 }),
          // Scalars (bound to `$n`) plus arrays (for `= ANY($n)`); deliberately not bare objects.
          params: t.Optional(
            t.Array(t.Union([t.String(), t.Number(), t.Boolean(), t.Null(), t.Array(t.Unknown())])),
          ),
        }),
      },
    )
}
