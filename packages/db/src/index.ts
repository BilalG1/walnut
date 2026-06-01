export * as schema from './schema.ts'
export {
  users,
  projects,
  agents,
  agentGrants,
  scopeRequests,
} from './schema.ts'
export type {
  ProjectStatus,
  ScopeRequestStatus,
  GrantResourceType,
  User,
  Project,
  NewProject,
  Agent,
  NewAgent,
  AgentGrant,
  NewAgentGrant,
  ScopeRequest,
  NewScopeRequest,
} from './schema.ts'
export { openDb } from './client.ts'
export type { Database, DbHandle, Schema } from './client.ts'
export { migrationsFolder, runMigrations } from './migrator.ts'
