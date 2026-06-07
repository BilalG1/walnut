/**
 * Owner-level storage "Connect" tokens — the service behind the Storage tab's Connect button.
 *
 * A token is the object-storage analog of a branch's owner database connection URI: a long-lived
 * bearer credential that grants FULL read/write/delete on exactly one branch's storage, for a
 * human's own application to use over the `/storage/v1` surface. It deliberately sidesteps the
 * agent scope/approval loop (it's the user's own branch — the same posture as showing them the
 * owner DB connection string), and like every other secret in the platform only its SHA-256 hash
 * is stored, so a lost token is rotated by minting a new one and revoking the old, never re-shown.
 *
 * Management (create/list/revoke) is authorized by org membership via `getProject`; authentication
 * of a token at request time is {@link resolveStorageToken}. Everything here is pure metadata — the
 * object store is never touched, so revoking is just a row delete that stops authenticating.
 */
import { hashKey, keyPrefix, newStorageToken, RESOURCE_LIMITS } from '@walnut/core'
import { type Branch, branches, branchStorageTokens, type BranchStorageToken, type Project } from '@walnut/db'
import { and, count, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { limitExceeded, notFound } from '../errors.ts'
import { getProject, getProjectInternal, resolveBranch } from './projects.ts'

/** A freshly minted token: the stored row plus the plaintext, which is returned exactly once. */
export interface CreatedStorageToken {
  token: BranchStorageToken
  /** Plaintext token — shown to the caller once at creation, never persisted (only its hash is). */
  secret: string
}

/** Resolve the branch a storage-token operation targets, asserting the caller is a member of the
 * owning project's org (the dashboard authorization gate, same as the rest of the storage UI). */
async function authorizeBranch(
  ctx: AppContext,
  projectId: string,
  branchName: string,
  userId: string,
): Promise<Branch> {
  await getProject(ctx, projectId, userId)
  return resolveBranch(ctx, projectId, branchName)
}

/** Mint an owner-level storage token for a branch. Caps per-branch token count first (cheap
 * metadata, but each token is a full-access credential, so sprawl is bounded). Returns the
 * plaintext exactly once; only its hash is stored. */
export async function createStorageToken(
  ctx: AppContext,
  projectId: string,
  branchName: string,
  userId: string,
  input: { label: string },
): Promise<CreatedStorageToken> {
  const branch = await authorizeBranch(ctx, projectId, branchName, userId)
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: count() })
    .from(branchStorageTokens)
    .where(eq(branchStorageTokens.branchId, branch.id))
  if (n >= RESOURCE_LIMITS.storageTokensPerBranch) {
    throw limitExceeded(
      `This branch has reached its limit of ${RESOURCE_LIMITS.storageTokensPerBranch} storage tokens.`,
      { limit: 'storage_tokens_per_branch', max: RESOURCE_LIMITS.storageTokensPerBranch, scope: 'branch' },
    )
  }
  const secret = newStorageToken()
  const [token] = await ctx.db
    .insert(branchStorageTokens)
    .values({
      branchId: branch.id,
      label: input.label,
      keyHash: hashKey(secret),
      keyPrefix: keyPrefix(secret),
    })
    .returning()
  if (token === undefined) {
    throw notFound('Branch')
  }
  return { token, secret }
}

/** A branch's storage tokens (newest first), for the dashboard's token list. Never the secret. */
export async function listStorageTokens(
  ctx: AppContext,
  projectId: string,
  branchName: string,
  userId: string,
): Promise<BranchStorageToken[]> {
  const branch = await authorizeBranch(ctx, projectId, branchName, userId)
  return ctx.db
    .select()
    .from(branchStorageTokens)
    .where(eq(branchStorageTokens.branchId, branch.id))
    .orderBy(desc(branchStorageTokens.createdAt))
}

/** Revoke (delete) a storage token. Scoped to the branch the caller can access, so a token id from
 * another branch/org can't be deleted (and doesn't leak existence — 404 either way). Pure metadata:
 * the token simply stops authenticating on its next use. */
export async function revokeStorageToken(
  ctx: AppContext,
  projectId: string,
  branchName: string,
  tokenId: string,
  userId: string,
): Promise<void> {
  const branch = await authorizeBranch(ctx, projectId, branchName, userId)
  const deleted = await ctx.db
    .delete(branchStorageTokens)
    .where(and(eq(branchStorageTokens.id, tokenId), eq(branchStorageTokens.branchId, branch.id)))
    .returning({ id: branchStorageTokens.id })
  if (deleted.length === 0) {
    throw notFound('Storage token')
  }
}

/** Authenticate a `/storage/v1` request: resolve a plaintext token to its branch + owning project,
 * or undefined if no such token. Stamps `lastUsedAt` so the dashboard can show token activity.
 * Returns the project so callers can run the storage service (its caps key off the org). */
export async function resolveStorageToken(
  ctx: AppContext,
  secret: string,
): Promise<{ token: BranchStorageToken; branch: Branch; project: Project } | undefined> {
  const [token] = await ctx.db
    .select()
    .from(branchStorageTokens)
    .where(eq(branchStorageTokens.keyHash, hashKey(secret)))
    .limit(1)
  if (token === undefined) {
    return undefined
  }
  const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, token.branchId)).limit(1)
  if (branch === undefined) {
    return undefined
  }
  const project = await getProjectInternal(ctx, branch.projectId)
  await ctx.db
    .update(branchStorageTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(branchStorageTokens.id, token.id))
  return { token, branch, project }
}
