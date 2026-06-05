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
import { sql } from 'drizzle-orm'
import type { AppContext } from '../context.ts'

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
