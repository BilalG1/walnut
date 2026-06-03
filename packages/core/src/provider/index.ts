import { createLocalProvider } from './local.ts'
import { createNeonProvider } from './neon.ts'
import type { DatabaseProvider, ProviderKind } from './types.ts'

export type {
  CreateBranchInput,
  DatabaseProvider,
  DestroyBranchInput,
  ProviderKind,
  ProvisionedDatabase,
  ProvisionedProject,
} from './types.ts'

export interface ProviderConfig {
  kind: ProviderKind
  /** Admin connection string for the local provider. */
  localAdminUrl?: string
  /** Per-project database-name prefix for the local provider (default `proj`). Lets
   * parallel test suites isolate their per-project databases. */
  localDbPrefix?: string
  /** API key for the Neon provider. */
  neonApiKey?: string
}

export function createProvider(config: ProviderConfig): DatabaseProvider {
  if (config.kind === 'neon') {
    if (config.neonApiKey === undefined || config.neonApiKey === '') {
      throw new Error('DB_PROVIDER=neon requires NEON_API_KEY to be set')
    }
    return createNeonProvider(config.neonApiKey)
  }
  if (config.localAdminUrl === undefined || config.localAdminUrl === '') {
    throw new Error('DB_PROVIDER=local requires LOCAL_PG_ADMIN_URL to be set')
  }
  return createLocalProvider(config.localAdminUrl, config.localDbPrefix)
}
