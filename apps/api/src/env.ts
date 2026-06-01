import type { ProviderConfig, ProviderKind } from '@walnut/core'

export interface Env {
  port: number
  databaseUrl: string
  corsOrigins: string[]
  provider: ProviderConfig
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
  }
}
