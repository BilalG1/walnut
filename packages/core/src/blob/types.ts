/**
 * The `BlobProvider` abstraction — the storage analog of `DatabaseProvider`. It is the
 * provider-agnostic seam over a "dumb", content-addressed, immutable object store: it knows
 * nothing about branches, scopes, or the manifest. All branch intelligence lives in the
 * Postgres layered manifest; this interface only moves opaque bytes by physical key.
 *
 * Two implementations, mirroring `local`/`neon` for the database:
 *  - `local`  — MinIO in docker-compose, for tests/offline dev.
 *  - `r2`     — Cloudflare R2 in production (no egress fees; agents read constantly).
 * Both speak S3, so prod and local exercise the same code path (see `s3.ts`).
 *
 * Bytes never stream through the API: callers mint short-TTL, single-object presigned URLs
 * and the client PUTs/GETs directly, so the API never buffers a blob (no `runSql`-style OOM
 * surface). The API + presign logic is the ONLY enforcement layer for blobs (unlike the DB,
 * there is no engine-level backstop), so authorization happens at presign time over the
 * resolved `(branch, path)` — never by trusting a client-supplied key.
 */
export type BlobProviderKind = 'local' | 'r2'

export interface PresignOptions {
  /** TTL in seconds for the minted URL — kept short (~60s) so a leaked URL expires fast. */
  expiresInSeconds: number
  /** Logical filename to force as the download name (via a signed `Content-Disposition`). Physical
   * keys are content-addressed hashes, so without this a browser would save the file as the hash;
   * set it to the object's logical base name so downloads keep their real name. */
  downloadFilename?: string
}

export interface PresignPutOptions extends PresignOptions {
  /** Content type to bind into the signed PUT, when known. */
  contentType?: string
}

/** The result of a HEAD on a physical key — used at commit to capture the *real* size/etag
 * (never trust the client-declared size) and by GC to confirm a byte exists. */
export interface BlobHead {
  /** Whether the object exists in the store. */
  exists: boolean
  /** Size in bytes the store reports (0 when absent). */
  size: number
  /** The store's entity tag, when present. */
  etag: string | null
}

export interface BlobProvider {
  readonly kind: BlobProviderKind
  /** A short-TTL, single-object presigned PUT URL for `key`. The bytes upload directly to
   * the store, never through the API. */
  presignPut(key: string, options: PresignPutOptions): Promise<string>
  /** A short-TTL, single-object presigned GET URL for `key`. */
  presignGet(key: string, options: PresignOptions): Promise<string>
  /** HEAD `key`: capture the real size/etag at commit, and confirm existence for GC. */
  head(key: string): Promise<BlobHead>
  /** Delete `key`'s bytes. GC is the ONLY caller — immutable blobs are never otherwise
   * removed — and the delete is idempotent (deleting an absent key is a no-op). */
  delete(key: string): Promise<void>
  /** Ensure the backing bucket exists; idempotent and safe to call on every startup. */
  ensureBucket(): Promise<void>
}

export interface BlobProviderConfig {
  kind: BlobProviderKind
  /** S3 endpoint. For `local` this is the MinIO URL (derive from PORT_PREFIX); for `r2` the
   * account endpoint (`https://<account>.r2.cloudflarestorage.com`). */
  endpoint: string
  /** The single bucket all projects share; keys are project-prefixed for isolation. */
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** S3 region. R2 ignores it ("auto"); MinIO accepts any value. */
  region?: string
}
