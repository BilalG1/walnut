export {
  DB_SCOPES,
  ALL_SCOPES,
  SCOPE_DESCRIPTIONS,
  GRANT_RESOURCE_TYPES,
  SCOPES_BY_RESOURCE,
  isAgentScope,
  isScopeValidForResource,
  parseScopes,
  parseScopesForResource,
  missingScopes,
  effectiveScopes,
  scopeMask,
  scopeSetKey,
} from './scopes.ts'
export type { AgentScope, DbScope, GrantResourceType, ScopeWithExpiry } from './scopes.ts'

export { classifySql } from './sql.ts'
export type { SqlClassification } from './sql.ts'

export { SYSTEM_USER_ID, newId, newAgentKey, newInviteToken, hashKey, keyPrefix, newDatabaseName } from './ids.ts'

export { createProvider } from './provider/index.ts'
export type {
  CreateBranchInput,
  DatabaseProvider,
  DestroyBranchInput,
  ProviderConfig,
  ProviderKind,
  ProvisionedDatabase,
  ProvisionedProject,
} from './provider/index.ts'

export { runSql } from './query.ts'
export type { QueryResult } from './query.ts'

export {
  DEFAULT_PORT_PREFIX,
  PORT_OFFSETS,
  normalizePortPrefix,
  portFor,
  localPostgresUrl,
  localServiceUrl,
} from './ports.ts'
export type { PortService, LocalDbUrlOptions } from './ports.ts'

export { DEFAULT_WALNUT_API_URL, DEFAULT_WALNUT_WEB_URL } from './urls.ts'

export { setupProjectRoles, ensureScopeRole, dropProjectRoles } from './roles.ts'
export type { ScopeRole } from './roles.ts'
