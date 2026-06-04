import { agents, branches, organizationMembers, organizations, projects, users, type Organization, type OrgRole } from '@walnut/db'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { AuthClaims } from '../auth/verify.ts'
import type { AppContext } from '../context.ts'
import { badRequest, HttpError, notFound } from '../errors.ts'

function internalError(message: string): HttpError {
  return new HttpError(500, { error: 'internal_error', message })
}

/** Friendly name for a user's auto-created personal org. */
function personalOrgName(claims: AuthClaims): string {
  return claims.name ?? claims.email ?? 'Personal'
}

/**
 * JIT-provision a verified user on first sight: ensure the user row, a personal
 * organization, and an owner membership all exist. Idempotent and race-safe — the
 * fast path is a single indexed membership lookup, so it's cheap to call on every
 * authenticated request.
 *
 * Race safety: the personal org is keyed by `organizations.personal_user_id` (UNIQUE),
 * so two concurrent first-logins can't create two personal orgs; the loser's
 * `onConflictDoNothing` no-ops and it reads back the winner's row.
 */
export async function provisionUser(ctx: AppContext, claims: AuthClaims): Promise<void> {
  const existing = await ctx.db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, claims.userId))
    .limit(1)
  if (existing.length > 0) {
    return
  }

  // Hexclave access tokens always carry an email; the fallback only guards a token
  // that somehow lacks one, so `users.email` (NOT NULL) is never violated.
  const email = claims.email ?? `${claims.userId}@users.noreply.hexclave`

  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: claims.userId, email })
      .onConflictDoUpdate({ target: users.id, set: { email } })

    const inserted = await tx
      .insert(organizations)
      .values({ name: personalOrgName(claims), isPersonal: true, personalUserId: claims.userId })
      .onConflictDoNothing({ target: organizations.personalUserId })
      .returning({ id: organizations.id })

    let orgId = inserted[0]?.id
    if (orgId === undefined) {
      const [row] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.personalUserId, claims.userId))
        .limit(1)
      orgId = row?.id
    }
    if (orgId === undefined) {
      throw internalError('Failed to provision personal organization.')
    }

    await tx
      .insert(organizationMembers)
      .values({ organizationId: orgId, userId: claims.userId, role: 'owner' })
      .onConflictDoNothing()
  })
}

/**
 * The org a new project is created in for this user. MVP: their personal org (every
 * user has exactly one). When org switching lands, the caller passes an explicit org
 * id instead and this becomes the fallback.
 */
export async function getDefaultOrgId(ctx: AppContext, userId: string): Promise<string> {
  const [personal] = await ctx.db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.personalUserId, userId))
    .limit(1)
  if (personal !== undefined) {
    return personal.id
  }
  const [membership] = await ctx.db
    .select({ id: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1)
  if (membership === undefined) {
    throw internalError('User has no organization.')
  }
  return membership.id
}

/** An organization the user belongs to, with the caller's role in it. */
export interface OrganizationWithRole {
  organization: Organization
  role: OrgRole
}

/** Every organization the user is a member of (personal org first, then by name). */
export async function listOrganizations(ctx: AppContext, userId: string): Promise<OrganizationWithRole[]> {
  const rows = await ctx.db
    .select({ organization: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(desc(organizations.isPersonal), asc(organizations.name))
  return rows.map((r) => ({ organization: r.organization, role: r.role }))
}

/** Throw 404 unless the user is a member of the org (don't leak that it exists). */
export async function assertOrgMember(ctx: AppContext, orgId: string, userId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1)
  if (row === undefined) {
    throw notFound('Organization')
  }
}

/** The org's live count of each capped resource — projects, branches (across all of its
 * projects), and agents. Mirrors the COUNTs the create-time limit guards run, surfaced
 * read-only for the settings page. */
export interface OrgUsageCounts {
  projects: number
  branches: number
  agents: number
}

/** Count the org's provisioned resources against the caps. Caller must be a member (404
 * otherwise, so usage never leaks an org's existence). The three counts run concurrently. */
export async function getOrgUsage(ctx: AppContext, orgId: string, userId: string): Promise<OrgUsageCounts> {
  await assertOrgMember(ctx, orgId, userId)
  const [projectRows, branchRows, agentRows] = await Promise.all([
    ctx.db.select({ n: count() }).from(projects).where(eq(projects.organizationId, orgId)),
    ctx.db
      .select({ n: count() })
      .from(branches)
      .innerJoin(projects, eq(branches.projectId, projects.id))
      .where(eq(projects.organizationId, orgId)),
    ctx.db.select({ n: count() }).from(agents).where(eq(agents.organizationId, orgId)),
  ])
  return {
    projects: projectRows[0]?.n ?? 0,
    branches: branchRows[0]?.n ?? 0,
    agents: agentRows[0]?.n ?? 0,
  }
}

/** A row of the org roster: the member's user id, email, role, and when they joined. */
export interface OrgMemberRow {
  userId: string
  email: string
  role: OrgRole
  joinedAt: Date
}

/** Every member of the org, oldest first (so the founding owner leads). Caller must be a member. */
export async function listMembers(ctx: AppContext, orgId: string, userId: string): Promise<OrgMemberRow[]> {
  await assertOrgMember(ctx, orgId, userId)
  return ctx.db
    .select({
      userId: organizationMembers.userId,
      email: users.email,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId))
    .orderBy(asc(organizationMembers.createdAt))
}

/**
 * Remove a member from an org. The caller must be a member (any member can manage membership —
 * no role gate yet). Refuses to remove the org's *last owner*, which would orphan it; this is a
 * data-integrity guard, not a permission (best-effort: the count-then-delete isn't serialized, so
 * two simultaneous owner-removals could still race — acceptable for the MVP). 404 if the target
 * isn't a member. Passing the caller's own id is "leave the org" — subject to the same guard.
 */
export async function removeMember(ctx: AppContext, orgId: string, targetUserId: string, userId: string): Promise<void> {
  await assertOrgMember(ctx, orgId, userId)
  const [target] = await ctx.db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, targetUserId)))
    .limit(1)
  if (target === undefined) {
    throw notFound('Member')
  }
  if (target.role === 'owner') {
    const owners = await ctx.db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, 'owner')))
    if (owners.length <= 1) {
      throw badRequest("Can't remove the organization's last owner.")
    }
  }
  await ctx.db
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, targetUserId)))
}
