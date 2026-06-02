import { Elysia, t } from 'elysia'
import { authenticate } from '../auth/middleware.ts'
import type { AppContext } from '../context.ts'
import { toActivityEventView, toAgentView, toBranchView, toProjectDetail, toProjectSummary } from '../serializers.ts'
import { listProjectActivity } from '../services/activity.ts'
import { createAgent, listAgents } from '../services/agents.ts'
import { createProject, deleteProject, getProject, listBranches, listProjects } from '../services/projects.ts'

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
      async ({ userId, body }) => toProjectDetail(await createProject(ctx, userId, body)),
      { body: t.Object({ name: nameSchema }) },
    )
    .get('/:id', async ({ userId, params }) => toProjectDetail(await getProject(ctx, params.id, userId)))
    .delete('/:id', async ({ userId, params }) => {
      await deleteProject(ctx, params.id, userId)
      return { deleted: true }
    })
    .get('/:id/agents', async ({ userId, params }) => {
      const rows = await listAgents(ctx, params.id, userId)
      return rows.map(({ agent, grants }) => toAgentView(agent, grants))
    })
    .get('/:id/branches', async ({ userId, params }) => {
      const rows = await listBranches(ctx, params.id, userId)
      return rows.map(toBranchView)
    })
    .get('/:id/activity', async ({ userId, params }) => {
      const rows = await listProjectActivity(ctx, params.id, userId)
      return rows.map((r) => toActivityEventView(r.event, r.agentName))
    })
    .post(
      '/:id/agents',
      async ({ userId, params, body }) => {
        const { agent, grants, apiKey } = await createAgent(ctx, params.id, userId, body)
        return { ...toAgentView(agent, grants), apiKey }
      },
      { body: t.Object({ name: nameSchema }) },
    )
}
