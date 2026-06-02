import type { ProviderConfig, ProviderKind } from '@walnut/core'

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
  auth: AuthEnv
  devAuth: DevAuthEnv
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function loadEnv(): Env {
  const providerKind = (process.env.DB_PROVIDER ?? 'local') as ProviderKind
  if (providerKind !== 'local' && providerKind !== 'neon') {
    throw new Error(`DB_PROVIDER must be "local" or "neon", got "${providerKind}"`)
  }

  return {
    port: Number(process.env.PORT ?? '3001'),
    databaseUrl: required('DATABASE_URL'),
    corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    provider: {
      kind: providerKind,
      localAdminUrl: process.env.LOCAL_PG_ADMIN_URL,
      neonApiKey: process.env.NEON_API_KEY,
    },
    auth: {
      projectId: required('HEXCLAVE_PROJECT_ID'),
      apiBaseUrl: process.env.HEXCLAVE_API_BASE_URL ?? 'https://api.hexclave.com',
    },
    devAuth: {
      enabled:
        (process.env.AUTH_DEV_BYPASS === '1' || process.env.AUTH_DEV_BYPASS === 'true') &&
        process.env.NODE_ENV !== 'production',
      secretServerKey: process.env.HEXCLAVE_SECRET_SERVER_KEY,
    },
  }
}
