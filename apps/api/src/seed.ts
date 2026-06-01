import { SYSTEM_USER_ID } from '@walnut/core'
import { users } from '@walnut/db'
import type { AppContext } from './context.ts'

/** Ensure the hard-coded placeholder user exists (stands in for real auth). */
export async function ensureSeed(ctx: AppContext): Promise<void> {
  await ctx.db
    .insert(users)
    .values({ id: SYSTEM_USER_ID, email: 'system@walnut.cloud' })
    .onConflictDoNothing()
}
