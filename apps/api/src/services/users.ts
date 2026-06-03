import { users, type User } from '@walnut/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError } from '../errors.ts'

/** The authenticated user's row. `authenticate` JIT-provisions it, so it always exists by
 * the time a route calls this — a missing row is an internal invariant break, not a 404. */
export async function getUser(ctx: AppContext, userId: string): Promise<User> {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (row === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Authenticated user has no row.' })
  }
  return row
}

/**
 * Mark onboarding complete (idempotent): stamp `onboarding_completed_at` the first time and
 * leave the original timestamp untouched on repeat calls, so re-finishing or skipping never
 * rewrites when the user actually first finished.
 */
export async function completeOnboarding(ctx: AppContext, userId: string): Promise<User> {
  const [row] = await ctx.db
    .update(users)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.onboardingCompletedAt)))
    .returning()
  // No row updated → it was already complete; return the current row unchanged.
  return row ?? (await getUser(ctx, userId))
}
