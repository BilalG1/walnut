import { createProvider, type DatabaseProvider, type ProviderConfig } from '@walnut/core'
import { openDb, type Database, type DbHandle } from '@walnut/db'
import type { AuthVerifier } from './auth/verify.ts'

export interface AppContext {
  db: Database
  provider: DatabaseProvider
  /** Verifies user access tokens for the dashboard API. */
  auth: AuthVerifier
}

export interface OwnedContext extends AppContext {
  /** Releases owned resources (db pool). Only present when this process created them. */
  close: () => Promise<void>
}

/** Build a context that owns its own database connection pool. */
export function createContext(
  databaseUrl: string,
  providerConfig: ProviderConfig,
  auth: AuthVerifier,
): OwnedContext {
  const handle: DbHandle = openDb(databaseUrl)
  const provider = createProvider(providerConfig)
  return {
    db: handle.db,
    provider,
    auth,
    close: handle.close,
  }
}
