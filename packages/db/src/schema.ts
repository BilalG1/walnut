import type { AgentScope, ProviderKind } from '@walnut/core'
import { boolean, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export type ProjectStatus = 'provisioning' | 'active' | 'error'
export type ScopeRequestStatus = 'pending' | 'approved' | 'denied'
/** A member's role within an organization. Only `owner` is exercised today; the
 * column exists so richer roles (admin/member) and invites slot in without a schema
 * change. */
export type OrgRole = 'owner' | 'admin' | 'member'
/**
 * The resource a grant (or scope request) is anchored to. Only `project` exists
 * today; `org` and `branch` slot in when those entities land — the grant model is
 * the extension point (see CLAUDE.md), which is why `agent_grants.resource_id` is a
 * bare uuid + discriminator rather than a single foreign key.
 */
export type GrantResourceType = 'project'

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  createdAt,
})

/**
 * An organization owns projects; users access projects through org membership.
 * Every user gets a `personal` org on first login (see `provisionUser`); shared
 * orgs + invites layer onto the same `organization_members` table later.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isPersonal: boolean('is_personal').notNull().default(false),
  /** For a personal org, the user it belongs to. Unique → at most one personal org
   * per user (the JIT-provisioning idempotency key). Null for shared orgs, and
   * Postgres allows many NULLs in a UNIQUE column, so they never collide. */
  personalUserId: uuid('personal_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  createdAt,
})

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<OrgRole>().notNull().default('member'),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
)

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').$type<ProviderKind>().notNull(),
  /** Provider-side id used to destroy the database (Neon project id or local db name). */
  providerProjectId: text('provider_project_id'),
  /** Connection string for the provisioned database. Null until provisioning completes. */
  connectionUri: text('connection_uri'),
  region: text('region'),
  status: text('status').$type<ProjectStatus>().notNull().default('provisioning'),
  error: text('error'),
  createdAt,
})

/**
 * A line of a project's database. Every project gets one `main` branch on creation.
 * Today this is inert metadata pointing at the project's single database — the
 * `main` branch IS that database. Real branching (per-branch provisioned databases,
 * agents scoped to a branch) lands later; this table reserves the vocabulary so the
 * provider/role layer doesn't have to assume "one database per project forever"
 * (see CLAUDE.md). No DB/role identity hangs off it yet.
 */
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The branch a new agent/connection targets by default (the `main` branch). */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt,
  },
  (t) => [unique('branches_project_name_unique').on(t.projectId, t.name)],
)

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The agent's home/tenancy project (who created it). Authorization lives in
   * `agent_grants`, not here — eventually this pointer moves up to an org. */
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** SHA-256 of the agent's API key; the key itself is shown only once at creation. */
  keyHash: text('key_hash').notNull().unique(),
  /** Non-secret prefix kept for display. */
  keyPrefix: text('key_prefix').notNull(),
  createdAt,
})

/**
 * What an agent can do, and where. Each grant binds an agent to one resource node
 * (today always a project) with a set of scopes, enforced by its own restricted
 * Postgres role/connection. One agent can hold many grants (per-resource scopes);
 * for the MVP every agent has exactly one, on its home project.
 */
export const agentGrants = pgTable(
  'agent_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').$type<GrantResourceType>().notNull(),
    /** The resource this grant applies to (a project id, for now). No FK: the type
     * is polymorphic, so cascade cleanup rides on `agent_id` instead. */
    resourceId: uuid('resource_id').notNull(),
    scopes: jsonb('scopes').$type<AgentScope[]>().notNull().default([]),
    /** The agent's restricted Postgres role for this resource's database. */
    dbRole: text('db_role'),
    /** Connection string scoped to that role; the agent's queries run over this,
     * never the project owner connection. */
    connectionUri: text('connection_uri'),
    createdAt,
  },
  (t) => [unique('agent_grants_agent_resource_unique').on(t.agentId, t.resourceType, t.resourceId)],
)

export const scopeRequests = pgTable('scope_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  scopes: jsonb('scopes').$type<AgentScope[]>().notNull(),
  reason: text('reason'),
  status: text('status').$type<ScopeRequestStatus>().notNull().default('pending'),
  createdAt,
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrganizationMember = typeof organizationMembers.$inferSelect
export type NewOrganizationMember = typeof organizationMembers.$inferInsert
export type Branch = typeof branches.$inferSelect
export type NewBranch = typeof branches.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type AgentGrant = typeof agentGrants.$inferSelect
export type NewAgentGrant = typeof agentGrants.$inferInsert
export type ScopeRequest = typeof scopeRequests.$inferSelect
export type NewScopeRequest = typeof scopeRequests.$inferInsert
