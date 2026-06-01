import { Elysia, t } from 'elysia'
import type { AppContext } from '../context.ts'
import { toAgentView, toProjectDetail, toProjectSummary } from '../serializers.ts'
import { createAgent, listAgents } from '../services/agents.ts'
import { createProject, deleteProject, getProject, listProjects } from '../services/projects.ts'

const nameSchema = t.String({ minLength: 1, maxLength: 64 })

export function projectRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/api/projects' })
    .get('/', async () => {
      const rows = await listProjects(ctx)
      return rows.map(toProjectSummary)
    })
    .post(
      '/',
      async ({ body }) => toProjectDetail(await createProject(ctx, body)),
      { body: t.Object({ name: nameSchema }) },
    )
    .get('/:id', async ({ params }) => toProjectDetail(await getProject(ctx, params.id)))
    .delete('/:id', async ({ params }) => {
      await deleteProject(ctx, params.id)
      return { deleted: true }
    })
    .get('/:id/agents', async ({ params }) => {
      const rows = await listAgents(ctx, params.id)
      return rows.map(({ agent, grants }) => toAgentView(agent, grants))
    })
    .post(
      '/:id/agents',
      async ({ params, body }) => {
        const { agent, grants, apiKey } = await createAgent(ctx, params.id, body)
        return { ...toAgentView(agent, grants), apiKey }
      },
      { body: t.Object({ name: nameSchema }) },
    )
}
