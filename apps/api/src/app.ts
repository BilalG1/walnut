import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { HexclaveServerClient } from './auth/hexclave-server.ts'
import type { LocalAuth } from './auth/local-auth.ts'
import type { AppContext } from './context.ts'
import { HttpError } from './errors.ts'
import { captureException } from './observability.ts'
import { agentApiRoutes } from './routes/agent.ts'
import { agentRoutes } from './routes/agents.ts'
import { devAuthRoutes } from './routes/dev-auth.ts'
import { invitationRoutes } from './routes/invitations.ts'
import { localAuthRoutes } from './routes/local-auth.ts'
import { meRoutes } from './routes/me.ts'
import { organizationRoutes } from './routes/organizations.ts'
import { projectRoutes } from './routes/projects.ts'
import { scopeRequestRoutes } from './routes/scope-requests.ts'
import { storageApiRoutes } from './routes/storage.ts'
import { storageConnectRoutes } from './routes/storage-connect.ts'

export interface AppOptions {
  corsOrigins?: string[]
  /** When set, mounts the dev-only `POST /dev/auth/login` bypass (see devAuthRoutes).
   * Provided only in dev/test; never on a production request path. */
  devLogin?: HexclaveServerClient
  /** When set (local auth mode), mounts `POST /auth/local/login|refresh` — the offline,
   * passwordless self-host sign-in. See localAuthRoutes. */
  localAuth?: LocalAuth
}

export function createApp(ctx: AppContext, options: AppOptions = {}) {
  const app = new Elysia()
    .use(cors({ origin: options.corsOrigins ?? true }))
    .onError(({ code, error, set }) => {
      if (error instanceof HttpError) {
        set.status = error.status
        // Surface a standard Retry-After (seconds) for rate-limit responses alongside the
        // machine-readable retryAfterMs in the body. Only when there's a real wait — a
        // "retry immediately" (0) carries no useful header.
        if (typeof error.body.retryAfterMs === 'number' && error.body.retryAfterMs > 0) {
          set.headers['retry-after'] = String(Math.ceil(error.body.retryAfterMs / 1000))
        }
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
      console.error('Unhandled error:', error)
      // The catch-all: anything reaching here is an unexpected server fault, so report it.
      // HttpError/VALIDATION/NOT_FOUND are handled above and never get here.
      captureException(error, { elysiaCode: code })
      // Never leak the raw error message to the client — an unanticipated fault here is often
      // a driver/DB error whose text can disclose schema, table/column names, or internal hosts.
      // The real message is in the logs + Sentry above; the client gets a stable, generic one.
      return { error: 'internal_error', message: 'An unexpected error occurred.' }
    })
    .get('/health', () => ({ status: 'ok' as const }))
    .use(meRoutes(ctx))
    .use(organizationRoutes(ctx))
    .use(invitationRoutes(ctx))
    .use(projectRoutes(ctx))
    .use(agentRoutes(ctx))
    .use(scopeRequestRoutes(ctx))
    .use(agentApiRoutes(ctx))
    .use(storageApiRoutes(ctx))
    .use(storageConnectRoutes(ctx))

  // Mounted for their runtime side effect only; deliberately kept out of the exported
  // `App` type so the auth bootstrap endpoints never become part of the typed client
  // contract (the dashboard calls them via plain fetch, like dev-login).
  if (options.devLogin !== undefined) {
    app.use(devAuthRoutes(options.devLogin))
  }
  if (options.localAuth !== undefined) {
    app.use(localAuthRoutes(options.localAuth))
  }

  return app
}

export type App = ReturnType<typeof createApp>
