import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { AppContext } from './context.ts'
import { HttpError } from './errors.ts'
import { agentApiRoutes } from './routes/agent.ts'
import { agentRoutes } from './routes/agents.ts'
import { projectRoutes } from './routes/projects.ts'
import { scopeRequestRoutes } from './routes/scope-requests.ts'

export interface AppOptions {
  corsOrigins?: string[]
}

export function createApp(ctx: AppContext, options: AppOptions = {}) {
  return new Elysia()
    .use(cors({ origin: options.corsOrigins ?? true }))
    .onError(({ code, error, set }) => {
      if (error instanceof HttpError) {
        set.status = error.status
        return error.body
      }
      if (code === 'VALIDATION') {
        set.status = 422
        return { error: 'validation', message: error.message }
      }
      if (code === 'NOT_FOUND') {
        set.status = 404
        return { error: 'not_found', message: 'Route not found.' }
      }
      set.status = 500
      const message = error instanceof Error ? error.message : 'Internal server error'
      console.error('Unhandled error:', error)
      return { error: 'internal_error', message }
    })
    .get('/health', () => ({ status: 'ok' as const }))
    .use(projectRoutes(ctx))
    .use(agentRoutes(ctx))
    .use(scopeRequestRoutes(ctx))
    .use(agentApiRoutes(ctx))
}

export type App = ReturnType<typeof createApp>
