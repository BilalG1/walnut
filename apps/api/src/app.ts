import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { HexclaveServerClient } from './auth/hexclave-server.ts'
import type { AppContext } from './context.ts'
import { HttpError } from './errors.ts'
import { agentApiRoutes } from './routes/agent.ts'
import { agentRoutes } from './routes/agents.ts'
import { devAuthRoutes } from './routes/dev-auth.ts'
import { organizationRoutes } from './routes/organizations.ts'
import { projectRoutes } from './routes/projects.ts'
import { scopeRequestRoutes } from './routes/scope-requests.ts'

export interface AppOptions {
  corsOrigins?: string[]
  /** When set, mounts the dev-only `POST /dev/auth/login` bypass (see devAuthRoutes).
   * Provided only in dev/test; never on a production request path. */
  devLogin?: HexclaveServerClient
}

export function createApp(ctx: AppContext, options: AppOptions = {}) {
  const app = new Elysia()
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
    .use(organizationRoutes(ctx))
    .use(projectRoutes(ctx))
    .use(agentRoutes(ctx))
    .use(scopeRequestRoutes(ctx))
    .use(agentApiRoutes(ctx))

  // Mounted for its runtime side effect only; deliberately kept out of the exported
  // `App` type so it never becomes part of the typed client contract.
  if (options.devLogin !== undefined) {
    app.use(devAuthRoutes(options.devLogin))
  }

  return app
}

export type App = ReturnType<typeof createApp>
