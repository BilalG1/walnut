import type { BlobProviderConfig, BlobProviderKind, ProviderConfig, ProviderKind } from '@walnut/core'
import { localPostgresUrl, localS3Endpoint, localServiceUrl, portFor } from '@walnut/core/ports'

export interface AuthEnv {
  /** Hexclave project id; also the access-token audience. */
  projectId: string
  /** Hexclave API base, e.g. `https://api.hexclave.com`. */
  apiBaseUrl: string
}

export interface DevAuthEnv {
  /** Whether to mount the dev-login bypass. True only when AUTH_DEV_BYPASS is set AND
   * NODE_ENV is not production. */
  enabled: boolean
  /** Hexclave secret server key — required to mint dev sessions. Absent in prod. */
  secretServerKey?: string
}

export interface Env {
  port: number
  databaseUrl: string
  corsOrigins: string[]
  provider: ProviderConfig
  /** Object-store config for per-branch storage (MinIO locally, R2 in prod). */
  blob: BlobProviderConfig
  auth: AuthEnv
  devAuth: DevAuthEnv
}

/**
 * Resolve the blob (object-store) provider config. `local` mirrors the database `local`
 * provider: everything derives from PORT_PREFIX (the MinIO endpoint) with the docker-compose
 * root credentials as defaults, so offline/test runs need no extra env. `r2` is production —
 * it requires an explicit endpoint, bucket, and credentials (fail closed if any is missing).
 * Individual `STORAGE_*` vars override the derived defaults, same posture as `DATABASE_URL`.
 */
function loadBlobConfig(prefix: string | undefined): BlobProviderConfig {
  const kind = (process.env.STORAGE_PROVIDER ?? 'local') as BlobProviderKind
  if (kind !== 'local' && kind !== 'r2') {
    throw new Error(`STORAGE_PROVIDER must be "local" or "r2", got "${kind}"`)
  }
  const region = process.env.STORAGE_REGION?.trim() || 'auto'
  if (kind === 'r2') {
    // Production: every value is explicit — no `walnut`/MinIO defaults leak into prod.
    return {
      kind,
      endpoint: required('STORAGE_ENDPOINT'),
      bucket: required('STORAGE_BUCKET'),
      accessKeyId: required('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: required('STORAGE_SECRET_ACCESS_KEY'),
      region,
    }
  }
  // Local: derive everything from PORT_PREFIX + the docker-compose MinIO root credentials.
  return {
    kind,
    endpoint: process.env.STORAGE_ENDPOINT?.trim() || localS3Endpoint(prefix),
    bucket: process.env.STORAGE_BUCKET?.trim() || 'walnut',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID?.trim() || 'walnut',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || 'walnutminio',
    region,
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function loadEnv(): Env {
  const isProduction = process.env.NODE_ENV === 'production'

  const providerKind = (process.env.DB_PROVIDER ?? 'local') as ProviderKind
  if (providerKind !== 'local' && providerKind !== 'neon') {
    throw new Error(`DB_PROVIDER must be "local" or "neon", got "${providerKind}"`)
  }

  // Every local port — and the connection strings that embed one — derives from a
  // single PORT_PREFIX (default "30" -> 3000/3001/3002). Explicit env vars still win,
  // so production/Neon can pin a remote DATABASE_URL etc.
  const prefix = process.env.PORT_PREFIX

  // CORS must fail closed in production. The dev default (the local dashboard origin) is a
  // convenience that must never leak into prod — an empty/absent allowlist there would let
  // `createApp` fall back to the permissive `origin: true`, so refuse to boot instead.
  const corsRaw = process.env.CORS_ORIGIN?.trim()
  if (isProduction && (corsRaw === undefined || corsRaw === '')) {
    throw new Error(
      'CORS_ORIGIN must be set to your dashboard origin(s) when NODE_ENV=production — refusing to start with a permissive default.',
    )
  }
  const corsOrigins = (corsRaw && corsRaw.length > 0 ? corsRaw : localServiceUrl('web', prefix))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // The dev-login bypass mints real sessions from a bare email — it must never run in prod.
  // It's already gated three ways (see devAuthRoutes), but a prod deploy that sets the flag
  // is a misconfiguration we surface loudly (fail to boot) rather than silently ignore.
  const devBypassRequested = process.env.AUTH_DEV_BYPASS === '1' || process.env.AUTH_DEV_BYPASS === 'true'
  if (isProduction && devBypassRequested) {
    throw new Error('AUTH_DEV_BYPASS must not be enabled when NODE_ENV=production — unset it to start the server.')
  }

  return {
    port: process.env.PORT ? Number(process.env.PORT) : portFor('api', prefix),
    databaseUrl: process.env.DATABASE_URL?.trim() || localPostgresUrl({ database: 'walnut', prefix }),
    corsOrigins,
    provider: {
      kind: providerKind,
      localAdminUrl: process.env.LOCAL_PG_ADMIN_URL?.trim() || localPostgresUrl({ database: 'postgres', prefix }),
      neonApiKey: process.env.NEON_API_KEY,
    },
    blob: loadBlobConfig(prefix),
    auth: {
      projectId: required('HEXCLAVE_PROJECT_ID'),
      apiBaseUrl: process.env.HEXCLAVE_API_BASE_URL ?? 'https://api.hexclave.com',
    },
    devAuth: {
      enabled: devBypassRequested && !isProduction,
      secretServerKey: process.env.HEXCLAVE_SECRET_SERVER_KEY,
    },
  }
}
