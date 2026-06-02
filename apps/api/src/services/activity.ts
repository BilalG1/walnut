import { agents, queryEvents, type QueryEvent, type QueryEventStatus } from '@walnut/db'
import { desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { getProject } from './projects.ts'

const MAX_SQL = 10_000

export interface RecordQueryInput {
  agentId: string
  projectId: string
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
}

/** Recent query events for a project (caller must be a member of its org). */
export async function listProjectActivity(
  ctx: AppContext,
  projectId: string,
  userId: string,
  limit = 100,
): Promise<ActivityRow[]> {
  await getProject(ctx, projectId, userId)
  const rows = await ctx.db
    .select({ event: queryEvents, agentName: agents.name })
    .from(queryEvents)
    .innerJoin(agents, eq(queryEvents.agentId, agents.id))
    .where(eq(queryEvents.projectId, projectId))
    .orderBy(desc(queryEvents.createdAt))
    .limit(limit)
  return rows.map((r) => ({ event: r.event, agentName: r.agentName }))
}
