/**
 * Single source of truth for every platform limit — resource caps, per-request
 * caps, and rate-limit budgets. Everything that enforces a limit reads from here,
 * so the numbers live in exactly one place (mirroring how `ports.ts` centralizes
 * port derivation).
 *
 * Why these exist: the whole platform runs on **one shared Neon account** (a single
 * `NEON_API_KEY`). An abusive — or merely buggy-loop — tenant therefore doesn't just
 * run up its own bill; it can exhaust account-wide quotas (projects, branches/compute
 * endpoints, the Neon API rate limit) shared by *every* tenant, turning a cost problem
 * into a platform-wide outage. The caps below bound that blast radius. They layer:
 * resource caps set the durable cost ceiling, per-request caps stop a single request
 * from ballooning memory, and rate budgets absorb bursts.
 */

/**
 * Hard ceilings on how many of each provisioned resource a tenant may hold. Each is
 * checked with a `COUNT` *before* the provider call that would create the resource.
 * The **organization** is the anchor — today one org maps to one user (orgs are
 * JIT personal orgs, one per user), so a per-org cap is also a per-user cap. If
 * multi-org creation is ever added, these will need a per-user backstop above them.
 *
 * The check is count-then-insert (no surrounding transaction), so two simultaneous
 * creates at the ceiling can overshoot by the concurrency — a deliberate, bounded
 * best-effort, matching the codebase's existing posture (e.g. the branch-name pre-check
 * backed only by a unique constraint). The point is to stop runaway loops, not to be a
 * hard transactional quota.
 */
export const RESOURCE_LIMITS = {
  /** Neon projects per org. Each is a whole Neon project container, and Neon accounts
   * cap total projects — so this guards a shared account quota, not just cost. */
  projectsPerOrg: 10,
  /** Branches per project. Each branch provisions a Neon compute endpoint — the
   * headline cost surface. */
  branchesPerProject: 10,
  /** Branches per org across all its projects. Backstop so many-projects ×
   * few-branches can't slip past {@link branchesPerProject}. */
  branchesPerOrg: 25,
  /** Agents per org. Cheap (pure metadata) but bounds API-key sprawl. */
  agentsPerOrg: 25,
  /** Pending (unresolved) scope requests per agent. Bounds dashboard-notification
   * spam and metadata growth from a request flood. */
  pendingScopeRequestsPerAgent: 10,
} as const

/**
 * Caps applied to a single agent query, enforced in the query path. `runSql` buffers
 * every result row into memory, so an uncapped `SELECT *` on a huge table can OOM the
 * shared API server; the per-statement timeout (set on each scope role) bounds compute,
 * and these bound payload + result size.
 */
export const QUERY_LIMITS = {
  /** Max SQL payload accepted for execution, in UTF-8 bytes. Postgres itself tolerates
   * ~1GB; this rejects a single giant request before it reaches the engine. */
  maxSqlBytes: 100 * 1024,
  /** Max rows returned to the caller. Beyond this the result is truncated and flagged
   * (`truncated: true`) rather than rejected — a default-LIMIT, not an error. */
  maxResultRows: 10_000,
  /** Max serialized result size, in bytes — the row cap's companion for wide rows (a
   * handful of large JSON/bytea values can be huge even under the row cap). */
  maxResultBytes: 8 * 1024 * 1024,
  /** Per-statement execution timeout (ms). Bounds the DB-side work behind a query — the single
   * source for both the agent scope roles (set at the role level in `roles.ts`) and the dashboard
   * viewer's owner connection (set per-session in `runSql`), so neither path can run unbounded. */
  statementTimeoutMs: 15_000,
} as const

/** A token-bucket budget: up to `capacity` tokens (the largest instantaneous burst),
 * refilled at `refillPerSec` tokens per second (the sustained rate). One token per
 * request. */
export interface RateBudget {
  /** Max tokens in the bucket — the largest burst allowed before refill matters. */
  readonly capacity: number
  /** Tokens replenished per second — the sustained request rate. */
  readonly refillPerSec: number
}

/**
 * Rate-limit budgets, keyed per the subject noted on each. Chosen so steady-state
 * legitimate use never trips them; they exist to clip floods. Enforced by an
 * in-memory token-bucket limiter — adequate for the single-instance MVP, with the
 * resource caps above as the durable backstop if the limiter's state is lost on
 * restart (or doesn't span future multiple instances).
 */
export const RATE_LIMITS = {
  /** Agent SQL queries, keyed per agent: ~20/s sustained, 40 burst. */
  agentQuery: { capacity: 40, refillPerSec: 20 },
  /** Resource provisioning (create/delete project or branch), keyed per user: 5/min
   * sustained — these are slow, expensive, and hit the Neon API. */
  provisioningPerUser: { capacity: 5, refillPerSec: 5 / 60 },
  /** Provisioning across the whole platform — a single shared bucket that shields the
   * shared Neon account's API rate limit from a creation storm. */
  provisioningGlobal: { capacity: 20, refillPerSec: 5 },
  /** Scope requests, keyed per agent: 20/hour. */
  scopeRequestPerAgent: { capacity: 20, refillPerSec: 20 / 3600 },
  /** Agent key rotation, keyed per agent: 10/hour. */
  keyRotationPerAgent: { capacity: 10, refillPerSec: 10 / 3600 },
  /** Auth / login / token issuance, keyed per client IP: 30/min — a brute-force /
   * mint-storm guard. */
  authPerIp: { capacity: 30, refillPerSec: 30 / 60 },
} as const satisfies Record<string, RateBudget>

export type RateLimitName = keyof typeof RATE_LIMITS

/** Max concurrent in-flight queries per branch — a gauge, not a rate. Each query opens
 * its own short-lived connection, so this bounds open connections to a single branch DB
 * (Neon enforces a per-endpoint connection ceiling of its own). */
export const MAX_CONCURRENT_QUERIES_PER_BRANCH = 10

/** Machine-readable detail for a tripped limit — carried in the structured error body
 * so an agent (or the dashboard) can react: which limit, the ceiling, and where it
 * applies. Shared between the resource-cap and rate-limit error paths. */
export interface LimitExceededInfo {
  /** Stable identifier for the specific limit, e.g. `branches_per_project`. */
  limit: string
  /** The numeric ceiling that was hit. */
  max: number
  /** The resource scope the limit applies to (`org`, `project`, `branch`, `agent`,
   * `user`, `ip`, or `platform`). */
  scope: string
}

/** The number of UTF-8 bytes in a string — used to enforce {@link QUERY_LIMITS.maxSqlBytes}
 * against the wire size, not the (cheaper) JS character count. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}
