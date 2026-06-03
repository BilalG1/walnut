import { hashKey, keyPrefix, newInviteToken } from '@walnut/core'
import {
  organizationInvitations,
  organizationMembers,
  organizations,
  type OrganizationInvitation,
  type OrgRole,
} from '@walnut/db'
import { and, desc, eq, gt } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { badRequest, HttpError, notFound } from '../errors.ts'
import { assertOrgMember } from './organizations.ts'

/** How long a fresh invite link stays redeemable (7 days). */
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

/** Whether `userId` is already a member of the org (boolean form of {@link assertOrgMember}). */
async function isMember(ctx: AppContext, orgId: string, userId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1)
  return row !== undefined
}

/** Look up an invitation by its plaintext token (matched against the stored hash). 404 if no
 * such link exists — an unknown token is indistinguishable from a never-issued one. */
async function findByToken(ctx: AppContext, token: string): Promise<OrganizationInvitation> {
  const [inv] = await ctx.db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.tokenHash, hashKey(token)))
    .limit(1)
  if (inv === undefined) {
    throw notFound('Invitation')
  }
  return inv
}

/** The redeemability of an invite, collapsing status + expiry into one signal. */
export type InviteState = 'valid' | 'expired' | 'revoked' | 'accepted'

function inviteState(inv: OrganizationInvitation, now: Date): InviteState {
  if (inv.status === 'revoked') {
    return 'revoked'
  }
  if (inv.status === 'accepted') {
    return 'accepted'
  }
  if (inv.expiresAt.getTime() <= now.getTime()) {
    return 'expired'
  }
  return 'valid'
}

/** A human reason a redeem attempt failed, for the 400 body. */
function deadInviteReason(state: InviteState): string {
  switch (state) {
    case 'revoked':
      return 'This invite link has been revoked.'
    case 'accepted':
      return 'This invite link has already been used.'
    case 'expired':
      return 'This invite link has expired.'
    case 'valid':
      return 'This invite link is no longer valid.'
  }
}

export interface CreatedInvitation {
  invitation: OrganizationInvitation
  /** Plaintext token — returned once, embedded in the link, never persisted. */
  token: string
}

/**
 * Mint a link-based invite into a shared org. The caller must be a member (any member can invite —
 * no role gate yet). Personal orgs are single-user containers, so they're refused. Returns the
 * plaintext token exactly once; only its hash + display prefix are stored.
 */
export async function createInvitation(
  ctx: AppContext,
  orgId: string,
  userId: string,
  input: { role?: OrgRole } = {},
): Promise<CreatedInvitation> {
  await assertOrgMember(ctx, orgId, userId)
  const [org] = await ctx.db
    .select({ isPersonal: organizations.isPersonal })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (org === undefined) {
    throw notFound('Organization')
  }
  if (org.isPersonal) {
    throw badRequest('Personal organizations cannot have additional members.')
  }

  const token = newInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000)
  const [invitation] = await ctx.db
    .insert(organizationInvitations)
    .values({
      organizationId: orgId,
      role: input.role ?? 'member',
      tokenHash: hashKey(token),
      tokenPrefix: keyPrefix(token),
      invitedByUserId: userId,
      expiresAt,
    })
    .returning()
  if (invitation === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create invitation.' })
  }
  return { invitation, token }
}

/** Every live (pending, unexpired) invite link for the org, newest first. Caller must be a member. */
export async function listInvitations(ctx: AppContext, orgId: string, userId: string): Promise<OrganizationInvitation[]> {
  await assertOrgMember(ctx, orgId, userId)
  return ctx.db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, orgId),
        eq(organizationInvitations.status, 'pending'),
        gt(organizationInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(organizationInvitations.createdAt))
}

/**
 * Revoke (kill) an invite link. Caller must be a member; the invite must belong to the org (404
 * otherwise — no cross-org existence leak). Idempotent: only a still-pending link flips to
 * `revoked`; revoking an already-spent or already-revoked link is a no-op success.
 */
export async function revokeInvitation(ctx: AppContext, orgId: string, invitationId: string, userId: string): Promise<void> {
  await assertOrgMember(ctx, orgId, userId)
  const [inv] = await ctx.db
    .select({ organizationId: organizationInvitations.organizationId })
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, invitationId))
    .limit(1)
  if (inv === undefined || inv.organizationId !== orgId) {
    throw notFound('Invitation')
  }
  await ctx.db
    .update(organizationInvitations)
    .set({ status: 'revoked' })
    .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.status, 'pending')))
}

export interface InvitationPreview {
  organizationId: string
  organizationName: string
  role: OrgRole
  state: InviteState
  /** True if the signed-in viewer is already in the org (so the UI offers "go to org" not "join"). */
  alreadyMember: boolean
}

/** What the accept page shows before the user commits: which org + role the link grants, whether
 * it's still redeemable, and whether the viewer is already a member. 404 only for an unknown token. */
export async function previewInvitation(ctx: AppContext, token: string, userId: string): Promise<InvitationPreview> {
  const inv = await findByToken(ctx, token)
  const [org] = await ctx.db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, inv.organizationId))
    .limit(1)
  return {
    organizationId: inv.organizationId,
    organizationName: org?.name ?? 'an organization',
    role: inv.role,
    state: inviteState(inv, new Date()),
    alreadyMember: await isMember(ctx, inv.organizationId, userId),
  }
}

export interface AcceptedInvitation {
  organizationId: string
}

/**
 * Redeem an invite link: join the signed-in user to the org with the invite's role. Single-use —
 * one conditional UPDATE atomically flips the only-still-pending link to `accepted`, so exactly one
 * redeemer wins a race; the membership insert is `onConflictDoNothing`. Already being a member is an
 * idempotent success (double-click / re-open / joined another way). A dead link (revoked / expired /
 * already spent) is a 400. 404 only for an unknown token.
 */
export async function acceptInvitation(ctx: AppContext, token: string, userId: string): Promise<AcceptedInvitation> {
  const inv = await findByToken(ctx, token)
  const orgId = inv.organizationId

  if (await isMember(ctx, orgId, userId)) {
    return { organizationId: orgId }
  }

  return ctx.db.transaction(async (tx) => {
    const now = new Date()
    const claimed = await tx
      .update(organizationInvitations)
      .set({ status: 'accepted', acceptedAt: now, acceptedByUserId: userId })
      .where(
        and(
          eq(organizationInvitations.id, inv.id),
          eq(organizationInvitations.status, 'pending'),
          gt(organizationInvitations.expiresAt, now),
        ),
      )
      .returning({ id: organizationInvitations.id })
    if (claimed.length === 0) {
      // Lost the race or the link went dead between read and update — report the live reason.
      // (A vanished row — concurrent org/invite delete — falls through to the generic message.)
      const [current] = await tx
        .select()
        .from(organizationInvitations)
        .where(eq(organizationInvitations.id, inv.id))
        .limit(1)
      throw badRequest(current === undefined ? deadInviteReason('valid') : deadInviteReason(inviteState(current, now)))
    }
    await tx
      .insert(organizationMembers)
      .values({ organizationId: orgId, userId, role: inv.role })
      .onConflictDoNothing()
    return { organizationId: orgId }
  })
}
