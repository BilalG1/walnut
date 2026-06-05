/**
 * Storage manifest resolution — the read path, and the correctness heart of the feature.
 *
 * A branch's *effective view* of its object storage is a "nearest-ancestor-wins" overlay across
 * its denormalized {@link branches.ancestry} (nearest-first `{self, parent, …, root}`). Each
 * branch owns only its divergences (overwrites + tombstones); an unchanged path is inherited
 * from the nearest ancestor that has a row for it.
 *
 * **The one rule that has a classic latent bug:** pick the nearest-owner row *including
 * tombstones first*, and only THEN drop it if the winner is a tombstone. Filtering out
 * tombstones *before* choosing the winner would let a near-branch delete fail to shadow a
 * far-ancestor file, so a deleted file would wrongly reappear. Both queries below select the
 * winner over the full ancestry (tombstones included) and discard a tombstone winner afterwards.
 *
 * Paths are compared in **C collation** (byte ordering) so prefix ranges and keyset pagination
 * are stable and match the `(owner_branch_id, path COLLATE "C")` index. Only `committed` rows are
 * visible; an in-flight (`pending`) upload never shows up in a read.
 */
import { effectiveScopes, isSha256, physicalKey, type ScopeWithExpiry, type StorageScope, STORAGE_LIMITS } from '@walnut/core'
import { type Branch, branches, physicalObjects, type Project, projects, storageObjects } from '@walnut/db'
import { and, count, eq, sql } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { badRequest, HttpError, insufficientScope, limitExceeded, notFound } from '../errors.ts'

/** A resolved, live object in a branch's effective view (never a tombstone). */
export interface ResolvedObject {
  path: string
  /** The content-addressed physical key the bytes live at — server-side only. */
  physicalKey: string
  size: number
  contentType: string | null
  etag: string | null
}

/** One page of a prefix listing, with an opaque keyset cursor for the next page. */
export interface ListResult {
  objects: ResolvedObject[]
  /** Pass back as `after` to fetch the next page; null when the listing is exhausted. */
  nextCursor: string | null
}

/** The raw manifest row shape the resolution queries return (bigint `size` arrives as text). */
interface ManifestRow {
  path: string
  physicalKey: string | null
  deleted: boolean
  size: string | number
  contentType: string | null
  etag: string | null
}

/** Bind a list of uuids as a single Postgres `uuid[]` parameter. drizzle's `sql` would otherwise
 * expand a JS array into a parameter *list* (`$1, $2, …`), so we hand it the array literal
 * (`{a,b,c}`) as one text param and cast. The values come from the trusted `branches.ancestry`
 * uuid[] column, so the join is safe. */
function uuidArray(values: readonly string[]) {
  return sql`${`{${values.join(',')}}`}::uuid[]`
}

function toResolved(row: ManifestRow): ResolvedObject {
  return {
    path: row.path,
    // A live (non-deleted, committed) row always has bytes; only tombstones have a null key.
    physicalKey: row.physicalKey ?? '',
    size: Number(row.size),
    contentType: row.contentType,
    etag: row.etag,
  }
}

/**
 * Point-get: resolve `path` in the effective view of a branch whose ancestry is `ancestry`.
 * Returns the live object, or null when the path is absent OR shadowed by a nearer tombstone.
 * O(depth) — one indexed lookup per path, never O(objects).
 */
export async function resolveObject(
  ctx: AppContext,
  ancestry: readonly string[],
  path: string,
): Promise<ResolvedObject | null> {
  if (ancestry.length === 0) {
    return null
  }
  const anc = uuidArray(ancestry)
  // Nearest-owner-wins INCLUDING tombstones: order by the path's owner position in the ancestry
  // (1 = self, larger = further), take the single nearest. Then drop it if it's a tombstone.
  const rows = (await ctx.db.execute(sql`
    SELECT path,
           physical_key   AS "physicalKey",
           deleted,
           size,
           content_type   AS "contentType",
           etag
    FROM storage_objects
    WHERE path = ${path}
      AND owner_branch_id = ANY(${anc})
      AND state = 'committed'
    ORDER BY array_position(${anc}, owner_branch_id)
    LIMIT 1
  `)) as unknown as ManifestRow[]
  const row = rows[0]
  if (row === undefined || row.deleted) {
    return null
  }
  return toResolved(row)
}

/** The smallest string strictly greater than every string with `prefix` — but only for an ASCII
 * final character (incrementing a byte mid-codepoint would yield invalid UTF-8). Returns null to
 * skip the index upper bound; `starts_with` below is the always-correct backstop either way. */
function asciiPrefixUpperBound(prefix: string): string | null {
  if (prefix === '') {
    return null
  }
  const last = prefix.charCodeAt(prefix.length - 1)
  if (last >= 0x7f) {
    return null
  }
  return prefix.slice(0, -1) + String.fromCharCode(last + 1)
}

/**
 * Prefix-list: the effective view of every live object under `prefix`, paginated by keyset on
 * `path` (never OFFSET). For each path the nearest-owner row is chosen over the whole ancestry
 * (tombstones included), then tombstone winners are dropped — the same correctness rule as the
 * point-get. `starts_with` is the exact, byte-safe prefix bound; an ASCII upper bound is added
 * when possible so the C-collation index can seek rather than scan.
 */
export async function listObjects(
  ctx: AppContext,
  ancestry: readonly string[],
  prefix: string,
  opts: { after?: string; limit: number },
): Promise<ListResult> {
  if (ancestry.length === 0) {
    return { objects: [], nextCursor: null }
  }
  const hi = asciiPrefixUpperBound(prefix)
  const anc = uuidArray(ancestry)
  const prefixFilter = prefix === '' ? sql`true` : sql`starts_with(path, ${prefix})`
  const hiFilter = hi === null ? sql`true` : sql`path COLLATE "C" < ${hi}`
  // Keyset lower bound: distinguish "no cursor yet" (include everything from `prefix`, so an
  // empty-string path on the first page isn't lost) from "resume strictly after this path".
  const afterFilter = opts.after === undefined ? sql`true` : sql`path COLLATE "C" > ${opts.after}`

  const rows = (await ctx.db.execute(sql`
    SELECT path,
           physical_key AS "physicalKey",
           deleted,
           size,
           content_type AS "contentType",
           etag
    FROM (
      SELECT DISTINCT ON (path COLLATE "C")
             path,
             physical_key,
             deleted,
             size,
             content_type,
             etag
      FROM storage_objects
      WHERE owner_branch_id = ANY(${anc})
        AND state = 'committed'
        AND ${prefixFilter}
        AND ${hiFilter}
        AND path COLLATE "C" >= ${prefix}
        AND ${afterFilter}
      ORDER BY path COLLATE "C", array_position(${anc}, owner_branch_id)
    ) winners
    WHERE NOT deleted
    ORDER BY path COLLATE "C"
    LIMIT ${opts.limit}
  `)) as unknown as ManifestRow[]

  const objects = rows.map(toResolved)
  // A full page implies there may be more; the cursor is the last path returned.
  const nextCursor = objects.length === opts.limit ? (objects[objects.length - 1]?.path ?? null) : null
  return { objects, nextCursor }
}

// ─── Agent-facing operations ──────────────────────────────────────────────────────────────────
//
// The API + presign logic is the SOLE enforcement layer for blobs (object storage has no
// engine-level backstop like the Postgres scope roles). Authorization is the CALLER's job and
// happens before these run: the agent route asserts the agent's effective storage scope
// ({@link assertStorageScope}); the dashboard routes authorize by org membership (getProject).
// Agents only ever name `(branch, path)` and never see a physical key, and reads/writes hand back
// short-TTL, single-object presigned URLs so the bytes never transit the API.

/** Metadata view of a stored object handed back to agents — never the physical key. */
export interface ObjectView {
  path: string
  size: number
  contentType: string | null
  etag: string | null
}

/** A presigned download: the object metadata plus a short-TTL GET URL. */
export interface DownloadView extends ObjectView {
  url: string
  expiresInSeconds: number
}

/** The outcome of starting an upload: either a presigned PUT to perform, or an immediate commit
 * when the bytes already exist in this project (content-addressed dedup → idempotent write). */
export type UploadView =
  | { status: 'upload'; path: string; url: string; expiresInSeconds: number }
  | { status: 'committed'; path: string; size: number }

function toView(o: ResolvedObject): ObjectView {
  return { path: o.path, size: o.size, contentType: o.contentType, etag: o.etag }
}

/** Assert an agent holds `required` (its effective storage scope), or throw the machine-readable
 * 403 that drives the scope-request approval loop (identical shape to the db-query path). Called by
 * the agent route before each op; the dashboard authorizes by org membership instead. */
export function assertStorageScope(scopeRows: readonly ScopeWithExpiry[], required: StorageScope): void {
  const granted = effectiveScopes(scopeRows)
  if (!granted.includes(required)) {
    throw insufficientScope(
      `This operation requires the "${required}" scope but your agent is missing it. ` +
        'Ask the user to grant it with `walnut scope request` (see howToRequest for the exact command).',
      [required],
      granted,
    )
  }
}

/** Validate a logical key. Opaque text — only the manifest indexes it; the physical key derives
 * from the content hash, so a path can never traverse the object store. We just bound it. */
function validatePath(path: string): void {
  if (path.length === 0) {
    throw badRequest('Storage path must not be empty.')
  }
  if (path.length > STORAGE_LIMITS.maxPathLength) {
    throw badRequest(`Storage path is too long (max ${STORAGE_LIMITS.maxPathLength} characters).`)
  }
  // Reject C0 control characters (incl. NUL, newlines, tabs): they make near-invisible or
  // confusable keys and have no legitimate use in a logical key. (No injection risk — `path` is
  // always a bound parameter and never reaches the physical key — this is hygiene.)
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) < 0x20) {
      throw badRequest('Storage path must not contain control characters.')
    }
  }
}

/** The maximum-blob-size guard, applied to both the client-declared size (an early reject) and,
 * authoritatively, the real size captured by HEAD at commit. */
function assertWithinBlobSize(size: number): void {
  if (size > STORAGE_LIMITS.maxBlobBytes) {
    throw limitExceeded(`Object exceeds the maximum blob size of ${STORAGE_LIMITS.maxBlobBytes} bytes.`, {
      limit: 'max_blob_bytes',
      max: STORAGE_LIMITS.maxBlobBytes,
      scope: 'branch',
    })
  }
}

/** The committed view of a divergence row — a live object or a tombstone (the columns reads
 * resolve over). Writing one always clears any in-flight staging (see {@link upsertCommitted}). */
interface CommittedView {
  physicalKey: string | null
  deleted: boolean
  size: number
  contentType: string | null
  etag: string | null
}

/** Clear the staged-upload columns — the committed view is now authoritative. */
const CLEAR_STAGED = { stagedPhysicalKey: null, stagedSize: 0, stagedContentType: null } as const

/**
 * Stage an in-flight upload for `(branch, path)` WITHOUT disturbing any committed view. A
 * brand-new path inserts an invisible `pending` placeholder; an existing committed object or
 * tombstone keeps all of its committed columns and only records the staged bytes — so the live
 * version stays resolvable mid-overwrite and an abandoned upload never destroys it.
 * {@link commitUpload} later promotes the staged bytes into the committed view.
 */
async function stageUpload(
  ctx: AppContext,
  branchId: string,
  path: string,
  staged: { physicalKey: string; size: number; contentType: string | null },
): Promise<void> {
  await ctx.db
    .insert(storageObjects)
    .values({
      ownerBranchId: branchId,
      path,
      // A never-yet-committed new path: no committed view, so reads skip it until its first commit.
      state: 'pending',
      stagedPhysicalKey: staged.physicalKey,
      stagedSize: staged.size,
      stagedContentType: staged.contentType,
    })
    .onConflictDoUpdate({
      target: [storageObjects.ownerBranchId, storageObjects.path],
      // ONLY the staged columns — the committed view (physicalKey/deleted/size/contentType/etag/
      // state) is deliberately left untouched so an in-flight overwrite can't lose the live row.
      set: { stagedPhysicalKey: staged.physicalKey, stagedSize: staged.size, stagedContentType: staged.contentType },
    })
}

/** Write `(branch, path)`'s committed view directly (a dedup-hit upload that needs no PUT, or a
 * tombstone), clearing any in-flight staging. One statement, so reads never see an intermediate. */
async function upsertCommitted(ctx: AppContext, branchId: string, path: string, view: CommittedView): Promise<void> {
  const committed = { ...view, state: 'committed' as const, ...CLEAR_STAGED }
  await ctx.db
    .insert(storageObjects)
    .values({ ownerBranchId: branchId, path, ...committed })
    .onConflictDoUpdate({ target: [storageObjects.ownerBranchId, storageObjects.path], set: committed })
}

/** Promote a row's staged bytes into its committed view in one statement (the atomic overwrite
 * flip) and clear staging. The row is known to exist (createUpload staged it). */
async function promoteStaged(
  ctx: AppContext,
  branchId: string,
  path: string,
  view: CommittedView,
): Promise<typeof storageObjects.$inferSelect | undefined> {
  const [updated] = await ctx.db
    .update(storageObjects)
    .set({ ...view, state: 'committed', ...CLEAR_STAGED })
    .where(and(eq(storageObjects.ownerBranchId, branchId), eq(storageObjects.path, path)))
    .returning()
  return updated
}

/**
 * Enforce the storage caps for a write of `addBytes` at `path` — count-then-insert, like the
 * resource caps. Quota counts only what a branch OWNS (its divergence rows), never inherited bytes,
 * so branching a big dataset doesn't make every branch instantly over quota.
 *
 * Two tiers are checked: a **per-branch** cap (bounds one branch) and a **per-org** backstop (sums
 * over every branch in the org, via owner→branch→project→org), mirroring the DB resource caps. The
 * org is the tenant anchor on the shared R2 account.
 *
 * Called twice: at upload time against the *client-declared* size (an early, best-effort reject),
 * and again at commit against the *real* size from HEAD (the authoritative check — without it the
 * size limits would be decorative, since a presigned PUT can carry any number of bytes).
 *
 * - The **object-count** cap counts ALL rows (pending + committed + tombstones), so a flood of
 *   presigned-but-never-completed uploads can't slip past it.
 * - The **owned-bytes** cap counts only *committed, non-tombstone* rows (real stored bytes); a
 *   pending row's declared size is unverified and isn't "owned" until its bytes actually land.
 *
 * `replacedBytes` (the committed row being overwritten on this branch) is subtracted from both the
 * branch and the org owned sums — an overwrite frees its old bytes at every tier it counted in.
 */
async function enforceStorageCaps(
  ctx: AppContext,
  project: Project,
  branchId: string,
  path: string,
  addBytes: number,
): Promise<void> {
  const orgId = project.organizationId
  const [existing] = await ctx.db
    .select({ size: storageObjects.size, state: storageObjects.state })
    .from(storageObjects)
    .where(and(eq(storageObjects.ownerBranchId, branchId), eq(storageObjects.path, path)))
    .limit(1)
  // Object-count caps — a brand-new path adds a row; overwriting an existing owned path doesn't.
  if (existing === undefined) {
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: count() })
      .from(storageObjects)
      .where(eq(storageObjects.ownerBranchId, branchId))
    if (n >= STORAGE_LIMITS.maxObjectsPerBranch) {
      throw limitExceeded(`This branch has reached its limit of ${STORAGE_LIMITS.maxObjectsPerBranch} stored objects.`, {
        limit: 'storage_objects_per_branch',
        max: STORAGE_LIMITS.maxObjectsPerBranch,
        scope: 'branch',
      })
    }
    const [{ n: orgN } = { n: 0 }] = await ctx.db
      .select({ n: count() })
      .from(storageObjects)
      .innerJoin(branches, eq(storageObjects.ownerBranchId, branches.id))
      .innerJoin(projects, eq(branches.projectId, projects.id))
      .where(eq(projects.organizationId, orgId))
    if (orgN >= STORAGE_LIMITS.maxObjectsPerOrg) {
      throw limitExceeded(`This org has reached its limit of ${STORAGE_LIMITS.maxObjectsPerOrg} stored objects.`, {
        limit: 'storage_objects_per_org',
        max: STORAGE_LIMITS.maxObjectsPerOrg,
        scope: 'org',
      })
    }
  }
  // Owned-bytes caps — sum of committed, non-tombstone rows, minus the committed row being replaced
  // (a pending row isn't in the sum, so there's nothing to subtract for it).
  const replacedBytes = existing?.state === 'committed' ? Number(existing.size) : 0
  const [{ s } = { s: 0 }] = await ctx.db
    .select({ s: sql<string>`coalesce(sum(${storageObjects.size}), 0)` })
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.ownerBranchId, branchId),
        eq(storageObjects.deleted, false),
        eq(storageObjects.state, 'committed'),
      ),
    )
  if (Number(s) - replacedBytes + addBytes > STORAGE_LIMITS.maxOwnedBytesPerBranch) {
    throw limitExceeded(
      `This branch would exceed its storage quota of ${STORAGE_LIMITS.maxOwnedBytesPerBranch} owned bytes.`,
      { limit: 'storage_owned_bytes_per_branch', max: STORAGE_LIMITS.maxOwnedBytesPerBranch, scope: 'branch' },
    )
  }
  const [{ s: orgS } = { s: 0 }] = await ctx.db
    .select({ s: sql<string>`coalesce(sum(${storageObjects.size}), 0)` })
    .from(storageObjects)
    .innerJoin(branches, eq(storageObjects.ownerBranchId, branches.id))
    .innerJoin(projects, eq(branches.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, orgId),
        eq(storageObjects.deleted, false),
        eq(storageObjects.state, 'committed'),
      ),
    )
  if (Number(orgS) - replacedBytes + addBytes > STORAGE_LIMITS.maxOwnedBytesPerOrg) {
    throw limitExceeded(
      `This org would exceed its storage quota of ${STORAGE_LIMITS.maxOwnedBytesPerOrg} owned bytes.`,
      { limit: 'storage_owned_bytes_per_org', max: STORAGE_LIMITS.maxOwnedBytesPerOrg, scope: 'org' },
    )
  }
}

/**
 * Two-phase write, phase one. Authorize `storage:write`, validate, enforce caps, then either mint
 * a presigned PUT to the content-addressed key, or — when those exact bytes already exist in this
 * project AND are present in the store — record the manifest row as committed immediately (free
 * dedup, idempotent write). The client hashes up front, so our CLI presigns straight to
 * `blobs/<sha256>`; it then calls {@link commitUpload}.
 *
 * **Content-addressing trust boundary (a deliberate PoC limitation):** the physical key derives
 * from the *client-declared* sha256, and Bun's presign can't bind a checksum into the PUT, so a
 * client could store bytes that don't match the digest. The blast radius is one project: keys are
 * project-scoped, so a mismatch can never poison another tenant's bytes or be read cross-tenant —
 * and within a project all agents share one org/owner (the same mutual-trust model as `db:ddl`).
 * Size limits are NOT trusted to the client, though: they're re-enforced against the real HEAD
 * size at commit (see {@link commitUpload}). Hardening seam: bind `x-amz-checksum-sha256` once the
 * provider/SDK supports it, so the store itself rejects a mismatched body.
 */
export async function createUpload(
  ctx: AppContext,
  project: Project,
  branch: Branch,
  input: { path: string; sha256: string; size: number; contentType?: string },
): Promise<UploadView> {
  validatePath(input.path)
  if (!isSha256(input.sha256)) {
    throw badRequest('Invalid sha256: expected 64 lowercase hex characters.')
  }
  if (!Number.isSafeInteger(input.size) || input.size < 0) {
    throw badRequest('Invalid size: expected a non-negative integer.')
  }
  assertWithinBlobSize(input.size)
  await enforceStorageCaps(ctx, project, branch.id, input.path, input.size)

  const key = physicalKey(project.id, input.sha256)
  const contentType = input.contentType ?? null

  // Try to claim the physical object. If it already existed AND the bytes are really in the store,
  // we can skip the upload entirely. (A leftover physical row from a never-completed upload has no
  // bytes — fall through to a fresh presign in that case.)
  const claimed = await ctx.db
    .insert(physicalObjects)
    .values({ physicalKey: key, size: input.size })
    .onConflictDoNothing()
    .returning({ physicalKey: physicalObjects.physicalKey })
  if (claimed.length === 0) {
    const head = await ctx.blobProvider.head(key)
    if (head.exists) {
      // Dedup hit: re-check caps against the REAL size, not the client-declared one (a client
      // could declare a tiny size while pointing at an existing large key to slip the quota).
      assertWithinBlobSize(head.size)
      await enforceStorageCaps(ctx, project, branch.id, input.path, head.size)
      // The bytes already exist — commit straight into the committed view (atomic; clears any
      // in-flight staging) so an overwrite-by-dedup never exposes an intermediate state.
      await upsertCommitted(ctx, branch.id, input.path, {
        physicalKey: key,
        deleted: false,
        size: head.size,
        contentType,
        etag: head.etag,
      })
      return { status: 'committed', path: input.path, size: head.size }
    }
  }

  // New (or not-yet-uploaded) bytes: STAGE the upload — never touching any committed view — and
  // presign the PUT. commitUpload promotes the staged bytes once they land.
  await stageUpload(ctx, branch.id, input.path, { physicalKey: key, size: input.size, contentType })
  const url = await ctx.blobProvider.presignPut(key, {
    expiresInSeconds: STORAGE_LIMITS.presignTtlSeconds,
    contentType: input.contentType,
  })
  return { status: 'upload', path: input.path, url, expiresInSeconds: STORAGE_LIMITS.presignTtlSeconds }
}

/**
 * Two-phase write, phase two. After the client has PUT the bytes, HEAD the object to confirm it
 * exists and capture the REAL size/etag (never trust the client-declared size), update the
 * physical object's size, and flip the manifest row to `committed` — making it visible to reads.
 */
export async function commitUpload(
  ctx: AppContext,
  project: Project,
  branch: Branch,
  input: { path: string },
): Promise<ObjectView> {
  const [row] = await ctx.db
    .select()
    .from(storageObjects)
    .where(and(eq(storageObjects.ownerBranchId, branch.id), eq(storageObjects.path, input.path)))
    .limit(1)
  // A commit needs a staged upload (recorded by createUpload). No staged bytes → nothing to flip.
  const stagedKey = row?.stagedPhysicalKey ?? null
  if (row === undefined || stagedKey === null) {
    throw new HttpError(409, {
      error: 'no_pending_upload',
      message: `No pending upload for "${input.path}" on this branch. Start one with POST /agent/v1/storage/upload.`,
    })
  }
  const head = await ctx.blobProvider.head(stagedKey)
  if (!head.exists) {
    throw new HttpError(409, {
      error: 'upload_missing',
      message: `No uploaded bytes found for "${input.path}". PUT to the presigned URL before committing.`,
    })
  }
  // The presigned PUT is unconstrained, so the bytes that actually landed may be larger than the
  // client declared. Re-enforce the size caps against the REAL HEAD size before committing — this
  // is the authoritative check; the upload-time check on the declared size is only an early reject.
  assertWithinBlobSize(head.size)
  await enforceStorageCaps(ctx, project, branch.id, input.path, head.size)
  await ctx.db.update(physicalObjects).set({ size: head.size }).where(eq(physicalObjects.physicalKey, stagedKey))
  // Atomic flip: promote the staged bytes into the committed view (only now does the overwrite
  // become visible to reads), clearing the staging columns.
  const updated = await promoteStaged(ctx, branch.id, input.path, {
    physicalKey: stagedKey,
    deleted: false,
    size: head.size,
    contentType: row.stagedContentType,
    etag: head.etag,
  })
  return {
    path: input.path,
    size: updated?.size ?? head.size,
    contentType: updated?.contentType ?? row.stagedContentType,
    etag: updated?.etag ?? head.etag,
  }
}

/** Delete `path` on a branch by writing a tombstone (the bytes are shared, so they're never
 * removed inline — GC reclaims them once unreferenced). 404 if nothing resolves at `path`. */
export async function deleteObject(
  ctx: AppContext,
  branch: Branch,
  input: { path: string },
): Promise<{ path: string; deleted: true }> {
  const resolved = await resolveObject(ctx, branch.ancestry, input.path)
  if (resolved === null) {
    throw notFound('Object')
  }
  // Tombstone the committed view (and cancel any in-flight overwrite staging on this row).
  await upsertCommitted(ctx, branch.id, input.path, {
    physicalKey: null,
    deleted: true,
    size: 0,
    contentType: null,
    etag: null,
  })
  return { path: input.path, deleted: true }
}

/** Point-stat: the resolved object's metadata in this branch's effective view (404 if absent). */
export async function statObject(
  ctx: AppContext,
  branch: Branch,
  path: string,
): Promise<ObjectView> {
  const resolved = await resolveObject(ctx, branch.ancestry, path)
  if (resolved === null) {
    throw notFound('Object')
  }
  return toView(resolved)
}

/** Resolve `path` and mint a short-TTL presigned GET so the client downloads the bytes directly
 * from the store (never through the API). 404 if absent or shadowed by a tombstone. */
export async function downloadObject(
  ctx: AppContext,
  branch: Branch,
  path: string,
): Promise<DownloadView> {
  const resolved = await resolveObject(ctx, branch.ancestry, path)
  if (resolved === null) {
    throw notFound('Object')
  }
  const url = await ctx.blobProvider.presignGet(resolved.physicalKey, {
    expiresInSeconds: STORAGE_LIMITS.presignTtlSeconds,
  })
  return { ...toView(resolved), url, expiresInSeconds: STORAGE_LIMITS.presignTtlSeconds }
}

/** Prefix listing of the branch's effective view (metadata only, no physical keys), paginated. */
export async function listStorageObjects(
  ctx: AppContext,
  branch: Branch,
  input: { prefix?: string; after?: string; limit?: number },
): Promise<{ objects: ObjectView[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, input.limit ?? STORAGE_LIMITS.defaultListLimit), STORAGE_LIMITS.maxListLimit)
  const res = await listObjects(ctx, branch.ancestry, input.prefix ?? '', { after: input.after, limit })
  return { objects: res.objects.map(toView), nextCursor: res.nextCursor }
}
