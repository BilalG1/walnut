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
} from './scopes.ts'
export type { AgentScope, DbScope, GrantResourceType } from './scopes.ts'

export { classifySql } from './sql.ts'
export type { SqlClassification } from './sql.ts'

export { SYSTEM_USER_ID, newId, newAgentKey, hashKey, keyPrefix, newDatabaseName } from './ids.ts'

export { createProvider } from './provider/index.ts'
export type {
  DatabaseProvider,
  ProviderConfig,
  ProviderKind,
  ProvisionedDatabase,
} from './provider/index.ts'

export { runSql } from './query.ts'
export type { QueryResult } from './query.ts'

export {
  setupProjectRoles,
  createAgentRole,
  syncAgentScopes,
  dropAgentRole,
  dropProjectRoles,
} from './roles.ts'
export type { AgentRole } from './roles.ts'
