import { createApp } from './app.ts'
import { createHexclaveServerClient, type HexclaveServerClient } from './auth/hexclave-server.ts'
import { createRemoteVerifier } from './auth/verify.ts'
import { createContext } from './context.ts'
import { loadEnv } from './env.ts'
import { initSentry, isSentryEnabled } from './observability.ts'
import { ensureSeed } from './seed.ts'

// Initialize error reporting before anything else can throw, so startup failures are captured.
initSentry()

const env = loadEnv()
const verifier = createRemoteVerifier({ projectId: env.auth.projectId, apiBaseUrl: env.auth.apiBaseUrl })
const ctx = createContext(env.databaseUrl, env.provider, env.blob, verifier)

await ensureSeed(ctx)
// Ensure the storage bucket exists before serving — idempotent, so safe on every boot.
await ctx.blobProvider.ensureBucket()

let devLogin: HexclaveServerClient | undefined
if (env.devAuth.enabled) {
  if (env.devAuth.secretServerKey === undefined || env.devAuth.secretServerKey === '') {
    console.warn('⚠️  AUTH_DEV_BYPASS is on but HEXCLAVE_SECRET_SERVER_KEY is unset — dev login is disabled.')
  } else {
    devLogin = createHexclaveServerClient({
      apiBaseUrl: env.auth.apiBaseUrl,
      projectId: env.auth.projectId,
      secretServerKey: env.devAuth.secretServerKey,
    })
    console.warn(
      '⚠️  DEV AUTH BYPASS ACTIVE — POST /dev/auth/login mints real sessions from an email. Never enable in production.',
    )
  }
}

const app = createApp(ctx, { corsOrigins: env.corsOrigins, devLogin })
app.listen(env.port)

console.log(
  `🌰 Walnut API listening on http://localhost:${env.port} (provider: ${ctx.provider.kind}, sentry: ${isSentryEnabled() ? 'on' : 'off'})`,
)
