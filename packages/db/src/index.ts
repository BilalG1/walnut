export * as schema from './schema.ts'
export {
  users,
  projects,
  agents,
  scopeRequests,
} from './schema.ts'
export type {
  ProjectStatus,
  ScopeRequestStatus,
  User,
  Project,
  NewProject,
  Agent,
  NewAgent,
  ScopeRequest,
  NewScopeRequest,
} from './schema.ts'
export { openDb } from './client.ts'
export type { Database, DbHandle, Schema } from './client.ts'
export { migrationsFolder, runMigrations } from './migrator.ts'
