export {
  DB_SCOPES,
  BRANCH_SCOPES,
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
export type { AgentScope, BranchScope, DbScope, GrantResourceType, ScopeWithExpiry } from './scopes.ts'

export { classifySql } from './sql.ts'
export type { SqlClassification } from './sql.ts'

export { SYSTEM_USER_ID, newId, newAgentKey, newInviteToken, hashKey, keyPrefix, newDatabaseName } from './ids.ts'

export { createProvider, ProviderError, classifyProviderStatus } from './provider/index.ts'
export type {
  CreateBranchInput,
  DatabaseProvider,
  DestroyBranchInput,
  ProviderConfig,
  ProviderErrorReason,
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
  localS3Endpoint,
} from './ports.ts'
export type { PortService, LocalDbUrlOptions } from './ports.ts'

export { branchAncestry } from './storage/ancestry.ts'

export { createBlobProvider, isSha256, physicalKey, projectKeyPrefix, stagingKey } from './blob/index.ts'
export type {
  BlobHead,
  BlobProvider,
  BlobProviderConfig,
  BlobProviderKind,
  PresignOptions,
  PresignPutOptions,
} from './blob/index.ts'

export { DEFAULT_WALNUT_API_URL, DEFAULT_WALNUT_WEB_URL } from './urls.ts'

export { setupProjectRoles, ensureScopeRole, dropProjectRoles } from './roles.ts'
export type { ScopeRole } from './roles.ts'

export {
  RESOURCE_LIMITS,
  QUERY_LIMITS,
  RATE_LIMITS,
  MAX_CONCURRENT_QUERIES_PER_BRANCH,
  byteLength,
} from './limits.ts'
export type { RateBudget, RateLimitName, LimitExceededInfo } from './limits.ts'

export { createRateLimiter } from './rate-limit.ts'
export type { RateLimiter, RateLimitResult } from './rate-limit.ts'
