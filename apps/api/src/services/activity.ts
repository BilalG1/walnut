import { agents, branches, queryEvents, type QueryEvent, type QueryEventStatus } from '@walnut/db'
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { getProject, resolveBranch } from './projects.ts'

const MAX_SQL = 10_000

export interface RecordQueryInput {
  agentId: string
  projectId: string
  /** The branch the query targeted. */
  branchId: string
  sql: string
  status: QueryEventStatus
  command?: string | null
  requiredScopes?: string[]
  rowCount?: number | null
  errorMessage?: string | null
  durationMs?: number | null
}

/**
 * Persist one agent query attempt for the activity feed. Best-effort: a logging
 * failure must never break the agent's query response, so it swallows + logs errors.
 */
export async function recordQueryEvent(ctx: AppContext, input: RecordQueryInput): Promise<void> {
  try {
    await ctx.db.insert(queryEvents).values({
      agentId: input.agentId,
      projectId: input.projectId,
      branchId: input.branchId,
      sql: input.sql.slice(0, MAX_SQL),
      command: input.command ?? null,
      requiredScopes: input.requiredScopes ?? [],
      status: input.status,
      rowCount: input.rowCount ?? null,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs ?? null,
    })
  } catch (err) {
    console.error('Failed to record query event:', err)
  }
}

export interface ActivityRow {
  event: QueryEvent
  agentName: string
  /** The name of the branch the query ran against (null for legacy rows without a branch). */
  branchName: string | null
}

/**
 * Recent query events for a project (caller must be a member of its org), newest first.
 * Optionally scoped to a single branch by name (`branch`) — the per-branch activity view.
 */
export async function listProjectActivity(
  ctx: AppContext,
  projectId: string,
  userId: string,
  opts: { branch?: string; limit?: number } = {},
): Promise<ActivityRow[]> {
  await getProject(ctx, projectId, userId)
  const branchId = opts.branch === undefined ? undefined : (await resolveBranch(ctx, projectId, opts.branch)).id
  const rows = await ctx.db
    .select({ event: queryEvents, agentName: agents.name, branchName: branches.name })
    .from(queryEvents)
    .innerJoin(agents, eq(queryEvents.agentId, agents.id))
    .leftJoin(branches, eq(queryEvents.branchId, branches.id))
    .where(
      and(eq(queryEvents.projectId, projectId), branchId !== undefined ? eq(queryEvents.branchId, branchId) : undefined),
    )
    .orderBy(desc(queryEvents.createdAt))
    .limit(opts.limit ?? 100)
  return rows.map((r) => ({ event: r.event, agentName: r.agentName, branchName: r.branchName }))
}
