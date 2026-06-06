import { createApp } from './app.ts'
import { createHexclaveServerClient, type HexclaveServerClient } from './auth/hexclave-server.ts'
import { createLocalAuth, type LocalAuth } from './auth/local-auth.ts'
import { createRemoteVerifier, type AuthVerifier } from './auth/verify.ts'
import { createContext } from './context.ts'
import { loadEnv } from './env.ts'
import { initSentry, isSentryEnabled } from './observability.ts'
import { ensureSeed } from './seed.ts'

// Initialize error reporting before anything else can throw, so startup failures are captured.
initSentry()

const env = loadEnv()

// Choose the auth provider. `local` is the zero-config self-host default: an offline,
// passwordless provider with no Hexclave dependency. `hexclave` (set whenever a project
// id is configured — i.e. our hosted deploys) verifies real Hexclave tokens.
let verifier: AuthVerifier
let localAuth: LocalAuth | undefined
let devLogin: HexclaveServerClient | undefined
if (env.auth.mode === 'local') {
  localAuth = await createLocalAuth()
  verifier = localAuth.verifier
  console.warn(
    '🔓 LOCAL AUTH MODE — passwordless sign-in via POST /auth/local/login (self-host default). Set HEXCLAVE_PROJECT_ID to use Hexclave instead.',
  )
} else {
  const projectId = env.auth.projectId
  if (projectId === undefined) {
    throw new Error('HEXCLAVE_PROJECT_ID is required when AUTH_PROVIDER=hexclave.')
  }
  verifier = createRemoteVerifier({ projectId, apiBaseUrl: env.auth.apiBaseUrl })
  if (env.devAuth.enabled) {
    if (env.devAuth.secretServerKey === undefined || env.devAuth.secretServerKey === '') {
      console.warn('⚠️  AUTH_DEV_BYPASS is on but HEXCLAVE_SECRET_SERVER_KEY is unset — dev login is disabled.')
    } else {
      devLogin = createHexclaveServerClient({
        apiBaseUrl: env.auth.apiBaseUrl,
        projectId,
        secretServerKey: env.devAuth.secretServerKey,
      })
      console.warn(
        '⚠️  DEV AUTH BYPASS ACTIVE — POST /dev/auth/login mints real sessions from an email. Never enable in production.',
      )
    }
  }
}

const ctx = createContext(env.databaseUrl, env.provider, env.blob, verifier)

await ensureSeed(ctx)
// Ensure the storage bucket exists before serving — idempotent, so safe on every boot.
await ctx.blobProvider.ensureBucket()

const app = createApp(ctx, { corsOrigins: env.corsOrigins, devLogin, localAuth })
app.listen(env.port)

console.log(
  `🌰 Walnut API listening on http://localhost:${env.port} (provider: ${ctx.provider.kind}, sentry: ${isSentryEnabled() ? 'on' : 'off'})`,
)
