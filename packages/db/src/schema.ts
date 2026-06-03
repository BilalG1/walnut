import type { AgentScope, GrantResourceType, ProviderKind } from '@walnut/core'
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export type { GrantResourceType } from '@walnut/core'

export type ProjectStatus = 'provisioning' | 'active' | 'error'
export type ScopeRequestStatus = 'pending' | 'approved' | 'denied'
/** Outcome of an agent query attempt: ran, blocked by scope, or errored at the engine. */
export type QueryEventStatus = 'ok' | 'denied' | 'error'
/** A member's role within an organization. Only `owner` is exercised today; the
 * column exists so richer roles (admin/member) and invites slot in without a schema
 * change. */
export type OrgRole = 'owner' | 'admin' | 'member'

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  /** When the user finished (or skipped) the first-run onboarding wizard. Null = not yet
   * done; the dashboard routes such users into the guided get-started flow and hides the
   * org sidebar until this is set. A timestamp (not a bool) records *when*, by convention. */
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
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
  /** The agent's home organization (its tenancy). An agent acts across the org's
   * projects via per-resource rows in `agent_grants`; authorization lives there,
   * never here. Created with one grant on the project it was minted in. */
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** SHA-256 of the agent's API key; the key itself is shown only once at creation. */
  keyHash: text('key_hash').notNull().unique(),
  /** Non-secret prefix kept for display. */
  keyPrefix: text('key_prefix').notNull(),
  createdAt,
})

/**
 * What an agent can do, and where. Each grant binds an agent to one resource node
 * (an org, project, or branch) with a set of scopes, enforced by its own restricted
 * Postgres role/connection. One agent can hold many grants — one per resource it has
 * been granted access to. Every agent starts with a single project grant (its home).
 */
export const agentGrants = pgTable(
  'agent_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').$type<GrantResourceType>().notNull(),
    /** The id of the `resourceType` node this grant applies to (an org, project, or
     * branch id). No FK: the reference is polymorphic, so cascade cleanup rides on
     * `agent_id` instead. */
    resourceId: uuid('resource_id').notNull(),
    /** The agent's restricted Postgres role for this resource's database, and the
     * connection scoped to it. Both null until the agent's *first query* on the
     * resource provisions the role lazily — approval is a pure metadata write. */
    dbRole: text('db_role'),
    connectionUri: text('connection_uri'),
    /** Advisory snapshot of the scopes we last pushed to the Postgres role (the
     * "reconcile-on-read" fast-path key). The metadata DB — `agent_grant_scopes`,
     * expiry-filtered — is the source of truth; the Postgres role is a cache we
     * reconcile before each query. When this matches the grant's current effective
     * scopes we skip the role DDL entirely. Null until the first sync. Never trusted
     * for authorization, only to avoid redundant syncs. */
    syncedScopes: jsonb('synced_scopes').$type<AgentScope[]>(),
    createdAt,
  },
  (t) => [unique('agent_grants_agent_resource_unique').on(t.agentId, t.resourceType, t.resourceId)],
)

/**
 * One scope an agent holds on a grant, with an optional expiry. A scope row is the
 * unit that carries time — `expiresAt` null means permanent; a future timestamp means
 * the scope lapses then (enforced by re-syncing the Postgres role on the next query,
 * since role memberships don't expire on their own). Split out from `agent_grants` so
 * the per-resource role/connection (one row) stays single-instance while scopes (many,
 * each with its own expiry) hang off it.
 */
export const agentGrantScopes = pgTable(
  'agent_grant_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => agentGrants.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<AgentScope>().notNull(),
    /** When this scope lapses; null = permanent. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [unique('agent_grant_scopes_grant_scope_unique').on(t.grantId, t.scope)],
)

export const scopeRequests = pgTable('scope_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  /** The org the request belongs to (the requesting agent's org). Denormalized so the
   * dashboard scopes and approves requests by org membership without having to resolve
   * the target resource first. */
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** The resource the requested scopes apply to — same discriminator as `agent_grants`
   * (an org, project, or branch id). No FK: the reference is polymorphic. */
  resourceType: text('resource_type').$type<GrantResourceType>().notNull(),
  resourceId: uuid('resource_id').notNull(),
  scopes: jsonb('scopes').$type<AgentScope[]>().notNull(),
  reason: text('reason'),
  /** Optional time-box the agent asked for: how long (in seconds) the granted scopes
   * should last once approved. Null = permanent. The clock starts at *approval* (when
   * access actually begins), so this is a duration, not an absolute deadline. */
  expiresInSeconds: integer('expires_in_seconds'),
  status: text('status').$type<ScopeRequestStatus>().notNull().default('pending'),
  createdAt,
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

/**
 * An audit record of every agent query attempt — the dashboard's activity/oversight
 * feed. Captures what ran (or was blocked), under which scopes, and the outcome.
 * `sql` is stored verbatim (truncated by the caller); a denied attempt records no
 * command/rowCount since nothing executed.
 */
export const queryEvents = pgTable('query_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sql: text('sql').notNull(),
  /** Postgres command tag (SELECT/INSERT/…) when the query ran; null otherwise. */
  command: text('command'),
  requiredScopes: jsonb('required_scopes').$type<string[]>().notNull().default([]),
  status: text('status').$type<QueryEventStatus>().notNull(),
  rowCount: integer('row_count'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdAt,
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
export type AgentGrantScope = typeof agentGrantScopes.$inferSelect
export type NewAgentGrantScope = typeof agentGrantScopes.$inferInsert
export type ScopeRequest = typeof scopeRequests.$inferSelect
export type NewScopeRequest = typeof scopeRequests.$inferInsert
export type QueryEvent = typeof queryEvents.$inferSelect
export type NewQueryEvent = typeof queryEvents.$inferInsert
