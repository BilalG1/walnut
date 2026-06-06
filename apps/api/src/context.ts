import {
  createBlobProvider,
  createProvider,
  createRateLimiter,
  type BlobProvider,
  type BlobProviderConfig,
  type DatabaseProvider,
  type ProviderConfig,
  type RateLimiter,
} from '@walnut/core'
import { openDb, type Database, type DbHandle } from '@walnut/db'
import type { AuthVerifier } from './auth/verify.ts'

export interface AppContext {
  db: Database
  provider: DatabaseProvider
  /** The object store backing per-branch storage (MinIO locally, a remote S3 store in prod). */
  blobProvider: BlobProvider
  /** Verifies user access tokens for the dashboard API. */
  auth: AuthVerifier
  /** In-memory burst limiter (token buckets + concurrency gauges) shared across the app. */
  rateLimiter: RateLimiter
}

export interface OwnedContext extends AppContext {
  /** Releases owned resources (db pool). Only present when this process created them. */
  close: () => Promise<void>
}

/** Build a context that owns its own database connection pool. */
export function createContext(
  databaseUrl: string,
  providerConfig: ProviderConfig,
  blobConfig: BlobProviderConfig,
  auth: AuthVerifier,
  rateLimiter: RateLimiter = createRateLimiter(),
): OwnedContext {
  const handle: DbHandle = openDb(databaseUrl)
  const provider = createProvider(providerConfig)
  const blobProvider = createBlobProvider(blobConfig)
  return {
    db: handle.db,
    provider,
    blobProvider,
    auth,
    rateLimiter,
    close: handle.close,
  }
}
