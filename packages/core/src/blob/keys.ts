/**
 * Content-addressed physical key derivation — the "dumb, immutable bytes" half of the
 * storage model. A blob's physical key is a pure function of its bytes (their sha256) and
 * the project it lives in, so identical bytes within a project collapse to one key (free
 * dedup + idempotent writes), while different projects never share a key.
 *
 * **Why project-scoped, not globally content-addressed:** cross-tenant dedup would be a
 * read oracle — an agent could probe whether some bytes exist by hashing them and reading
 * the shared key. Prefixing every key with the project id confines dedup to a single
 * project's branch tree (exactly where sharing is intended) and is the prefix production
 * presign credentials are IAM-scoped to, so even a bug can't presign outside the project.
 *
 * Agents NEVER see or supply a physical key — they only ever name `(branch, path)`. These
 * helpers are server-side only; the manifest maps a logical path to the physical key.
 */

/** A 64-char lowercase-hex sha256 digest. */
const SHA256_RE = /^[0-9a-f]{64}$/

/** True for a well-formed lowercase-hex sha256 digest (what content addressing requires). */
export function isSha256(value: string): boolean {
  return SHA256_RE.test(value)
}

/** The key prefix every physical object in a project lives under. Production scopes the
 * presign credentials to exactly this prefix, so a presign can never escape the project. */
export function projectKeyPrefix(projectId: string): string {
  return `${projectId}/`
}

/**
 * The immutable, content-addressed physical key for `sha256` bytes in `projectId`:
 * `<projectId>/blobs/<sha256>`. Written once, never mutated. Throws on a malformed digest
 * so a bad hash can't smuggle a path-traversing key past the store.
 */
export function physicalKey(projectId: string, sha256: string): string {
  if (!isSha256(sha256)) {
    throw new Error(`Invalid sha256 digest: ${sha256}. Expected 64 lowercase hex chars.`)
  }
  return `${projectKeyPrefix(projectId)}blobs/${sha256}`
}

/**
 * A staging key for the browser two-phase write (`<projectId>/staging/<uuid>`): the browser
 * can't be trusted to pre-hash, so it uploads here first and `/commit` HEADs + promotes the
 * bytes to their content-addressed `blobs/<hash>` key. A seam for the PoC — the CLI hashes
 * up front and presigns straight to {@link physicalKey} — but kept project-scoped for the
 * same isolation reason.
 */
export function stagingKey(projectId: string, uploadId: string): string {
  return `${projectKeyPrefix(projectId)}staging/${uploadId}`
}
