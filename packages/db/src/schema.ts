import type { AgentScope, GrantResourceType, ProviderKind } from '@walnut/core'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

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

/** Lifecycle of an org invite link: live, redeemed, or cancelled. */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked'

/**
 * A link-based invitation into a (shared) organization. Link-only: creating one mints a
 * secret token (returned once, embedded in a shareable URL); only its SHA-256 hash is stored,
 * so the link can never be re-derived. Whoever opens the link while signed in redeems it and
 * joins as `role`. There's no invitee email — an invite is a capability, contained by a single
 * use plus `expiresAt` and explicit revocation (`status = 'revoked'`).
 */
export const organizationInvitations = pgTable('organization_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** The role the redeemer joins with. */
  role: text('role').$type<OrgRole>().notNull().default('member'),
  /** SHA-256 of the invite token; the token itself lives only in the link, shown once. */
  tokenHash: text('token_hash').notNull().unique(),
  /** Non-secret leading slice of the token, kept so the dashboard can tell links apart. */
  tokenPrefix: text('token_prefix').notNull(),
  /** Who created the invite (provenance only). Null if that user is later deleted — an
   * invite is a capability anchored to the org, so it stays redeemable regardless. */
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').$type<InvitationStatus>().notNull().default('pending'),
  /** When the link stops working; a redeemed (`accepted`) or revoked link is dead regardless. */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  /** Who redeemed it (null until accepted; kept null if that user is later deleted). */
  acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt,
})

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').$type<ProviderKind>().notNull(),
  /** The provider-side *container* id (a Neon project). Null for flat providers (local) that
   * have no container — there the databases live on the branches and are torn down one by one. */
  providerProjectId: text('provider_project_id'),
  /** Coarse provisioning status of the project as a whole. Each branch carries its own
   * database + status (a project is a container of branches); this tracks the create flow. */
  status: text('status').$type<ProjectStatus>().notNull().default('provisioning'),
  error: text('error'),
  createdAt,
})

/**
 * A branch of a project — and the unit that owns a database. Every project gets one `main`
 * branch on creation; further branches are copy-on-write clones (Neon) / `TEMPLATE` copies
 * (local) of a parent. Each branch has its own provisioned database with its own connection
 * and scoped roles, so agents are granted (and queries run) against a specific branch.
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
    /** The branch this one was forked from (null for a project's `main`). Authoritative lineage;
     * the {@link ancestry} array is a derived cache of this chain. `set null` so a whole-project
     * cascade delete isn't blocked by the self-reference; deleting a branch that still has
     * children is blocked in the service layer (mirroring the default-branch rule). */
    parentId: uuid('parent_id').references((): AnyPgColumn => branches.id, { onDelete: 'set null' }),
    /** Denormalized nearest-first ancestry (`{self, parent, …, root}`) the storage manifest
     * resolves reads over — a rebuilt cache of the {@link parentId} chain, never hand-edited.
     * Empty only transiently before it's set on insert. */
    ancestry: uuid('ancestry').array().notNull().default(sql`ARRAY[]::uuid[]`),
    /** Provider-side id used to destroy this branch's database (Neon branch id / local db name). */
    providerBranchId: text('provider_branch_id'),
    /** Owner connection string for this branch's database. Null until provisioning completes. */
    connectionUri: text('connection_uri'),
    region: text('region'),
    status: text('status').$type<ProjectStatus>().notNull().default('provisioning'),
    error: text('error'),
    createdAt,
  },
  (t) => [unique('branches_project_name_unique').on(t.projectId, t.name)],
)

/** Whether a manifest row is an in-flight upload or a visible, durable object. Reads only ever
 * see `committed` rows; a `pending` row is a presigned-but-not-yet-confirmed upload. */
export type StorageObjectState = 'pending' | 'committed'

/**
 * The physical bytes layer of storage: one row per *immutable, content-addressed* blob, keyed by
 * its `<projectId>/blobs/<sha256>` physical key. This table — never an S3 LIST — drives garbage
 * collection: a physical key is collectable once no `storage_objects` row references it and it's
 * older than the upload grace window. The FK from `storage_objects.physical_key` makes Postgres
 * referential integrity the guard on the byte (a reference can't be added to a key GC is deleting).
 */
export const physicalObjects = pgTable('physical_objects', {
  /** `<projectId>/blobs/<sha256>` — the content-addressed key in the object store. */
  physicalKey: text('physical_key').primaryKey(),
  /** Authoritative size in bytes, captured from a HEAD at commit (never client-declared). */
  size: bigint('size', { mode: 'number' }).notNull(),
  createdAt,
})

/**
 * The "layered manifest" — each branch owns only its *divergences* (overwrites + tombstones),
 * never the unchanged base files, so the manifest grows with edits, not objects × branches.
 * A branch's effective view of a path is the nearest-ancestor-wins resolution over its
 * {@link branches.ancestry}: a write inserts a row owned by the writing branch (shadowing
 * ancestors); a delete inserts a tombstone row (`deleted = true`, null `physicalKey`) — bytes
 * are shared, so they're never removed inline. Lives in the platform DB (not the per-branch
 * databases) because the overlay query must span all of a project's branches.
 */
export const storageObjects = pgTable(
  'storage_objects',
  {
    /** The branch that wrote this divergence row. */
    ownerBranchId: uuid('owner_branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** Logical key — opaque text, compared with C collation in queries for byte ordering. */
    path: text('path').notNull(),
    /** The content-addressed byte this row points at; null for a tombstone. `restrict` so a
     * referenced byte can't be GC'd out from under a live row. */
    physicalKey: text('physical_key').references(() => physicalObjects.physicalKey, { onDelete: 'restrict' }),
    /** Tombstone flag: a delete marker that shadows any ancestor copy of this path. */
    deleted: boolean('deleted').notNull().default(false),
    /** Size in bytes (0 for a tombstone) — denormalized from the physical object for listings. */
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    contentType: text('content_type'),
    etag: text('etag'),
    /** Reads see only `committed`; `pending` is a presigned-but-unconfirmed upload. */
    state: text('state').$type<StorageObjectState>().notNull().default('pending'),
    /** Multipart upload id while a large blob is in flight (seam for multipart). */
    uploadId: text('upload_id'),
    createdAt,
  },
  (t) => [
    // One row per (branch, path): a branch's view of a path is a single divergence (write or
    // tombstone). Re-uploading upserts this row.
    primaryKey({ columns: [t.ownerBranchId, t.path] }),
    // Serves the cross-branch prefix-list: a per-branch range scan over `path` in **C collation**
    // (byte ordering), so `path >= prefix AND path < prefix_hi` is index-driven and matches the
    // byte semantics the resolution queries use (the default-collation PK can't serve a C-ordered
    // range). Leading `owner_branch_id` lets the planner scan each branch in the ancestry set.
    index('storage_objects_owner_path_c_idx').on(t.ownerBranchId, sql`${t.path} COLLATE "C"`),
    // GC / overwrite bookkeeping: find rows referencing a physical key.
    index('storage_objects_physical_key_idx').on(t.physicalKey),
  ],
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
 * What an agent can do, and where — pure policy. Each grant binds an agent to one resource
 * node (an org, project, or branch) with a set of scopes; one agent can hold many grants, one
 * per resource it has been granted access to. Enforcement is decoupled: a query computes the
 * agent's effective scopes from its grants, then runs over the branch database's *shared* scoped
 * role for that scope set (see `branch_db_roles`). So a grant never owns a Postgres role —
 * approval/denial/expiry are metadata writes, and the engine picks the matching connection.
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
    createdAt,
  },
  (t) => [unique('agent_grants_agent_resource_unique').on(t.agentId, t.resourceType, t.resourceId)],
)

/**
 * The shared, per-branch-database scoped Postgres roles, keyed by scope set. Enforcement is by
 * scope set, not by agent: for each combination of database scopes actually used on a branch we
 * provision one `LOGIN` role (member of exactly the matching group roles) and store its scoped
 * connection here. Any agent whose effective scopes on that branch collapse to that set runs its
 * queries over this connection — so there are at most 2⁴ = 16 roles per branch database, created
 * lazily on first use, and a scope change is just "select a different row". `scopeKey` is the
 * canonical bitmask (see `scopeSetKey`); the row caches the (otherwise re-creatable) role so we
 * never provision it twice.
 */
export const branchDbRoles = pgTable(
  'branch_db_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** Canonical key for the scope set this role grants (`scopeSetKey`). */
    scopeKey: text('scope_key').notNull(),
    /** The Postgres role name (`<dbprefix>_s<mask>`). */
    dbRole: text('db_role').notNull(),
    /** Connection scoped to that role (carries its generated password). */
    connectionUri: text('connection_uri').notNull(),
    createdAt,
  },
  (t) => [unique('branch_db_roles_branch_scope_unique').on(t.branchId, t.scopeKey)],
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
  /** The branch the query ran against. Null only for pre-branch rows; new events always set it. */
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
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
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert
export type Branch = typeof branches.$inferSelect
export type NewBranch = typeof branches.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type AgentGrant = typeof agentGrants.$inferSelect
export type NewAgentGrant = typeof agentGrants.$inferInsert
export type BranchDbRole = typeof branchDbRoles.$inferSelect
export type NewBranchDbRole = typeof branchDbRoles.$inferInsert
export type AgentGrantScope = typeof agentGrantScopes.$inferSelect
export type NewAgentGrantScope = typeof agentGrantScopes.$inferInsert
export type ScopeRequest = typeof scopeRequests.$inferSelect
export type NewScopeRequest = typeof scopeRequests.$inferInsert
export type QueryEvent = typeof queryEvents.$inferSelect
export type NewQueryEvent = typeof queryEvents.$inferInsert
export type StorageObject = typeof storageObjects.$inferSelect
export type NewStorageObject = typeof storageObjects.$inferInsert
export type PhysicalObject = typeof physicalObjects.$inferSelect
export type NewPhysicalObject = typeof physicalObjects.$inferInsert
