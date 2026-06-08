import { signPutBucket } from './sigv4.ts'
import type { BlobHead, BlobProvider, BlobProviderConfig, PresignOptions, PresignPutOptions } from './types.ts'

/**
 * The one S3-speaking `BlobProvider` implementation, shared by the `local` (MinIO) and `s3`
 * providers — they differ only in config (endpoint/credentials/addressing), so prod and local
 * exercise the exact same code path. Built on Bun's native `S3Client` (presign/stat/delete), so
 * there is no external AWS SDK dependency.
 *
 * Addressing style is config-driven (`pathStyle`): MinIO and Railway/Tigris buckets
 * (`t3.storageapi.dev`) need path-style — Tigris virtual-hosted addressing fails on
 * multi-segment keys (the HEAD surfaces as a bare `UnknownError`); R2 works with either,
 * real AWS S3 wants virtual-hosted. Defaults to path-style when unset.
 */
function createS3BlobProvider(config: BlobProviderConfig): BlobProvider {
  const { kind, endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto', pathStyle } = config
  const client = new Bun.S3Client({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    virtualHostedStyle: pathStyle === false,
  })

  return {
    kind,

    async presignPut(key: string, options: PresignPutOptions): Promise<string> {
      // Deliberately do NOT bind the content type into the signature: it would force the
      // uploader to echo an exact Content-Type header or the signature breaks, and the type
      // is not a security property (size/etag are captured authoritatively at commit via HEAD).
      return client.presign(key, { method: 'PUT', expiresIn: options.expiresInSeconds })
    },

    async presignGet(key: string, options: PresignOptions): Promise<string> {
      // Physical keys are content hashes, so without an explicit disposition the browser names
      // the download after the hash. Bind a signed `Content-Disposition` carrying the logical
      // filename so downloads keep their real name. (Signed into the URL, so it can't be tampered.)
      const contentDisposition =
        options.downloadFilename === undefined ? undefined : attachmentDisposition(options.downloadFilename)
      return client.presign(key, { method: 'GET', expiresIn: options.expiresInSeconds, contentDisposition })
    },

    async head(key: string): Promise<BlobHead> {
      try {
        const stat = await client.stat(key)
        return { exists: true, size: stat.size, etag: stat.etag ?? null }
      } catch (err) {
        // Only a genuine "the object isn't there" (NoSuchKey/404) means absent. Anything else —
        // a missing bucket, auth failure, network blip, 5xx — must propagate, or a transient
        // error at commit time would be misread as "the just-uploaded blob is missing".
        if (isObjectNotFound(err)) {
          return { exists: false, size: 0, etag: null }
        }
        throw err
      }
    },

    async delete(key: string): Promise<void> {
      // Idempotent: deleting an absent key is a no-op on S3/MinIO. GC is the only caller.
      await client.delete(key)
    },

    async ensureBucket(): Promise<void> {
      // Always issue the create (Bun has no bucket-create call, so we self-sign `PUT /<bucket>`).
      // It's idempotent: MinIO/S3 return 200 on create and 200/409 BucketAlreadyOwnedByYou when
      // it already exists — both are success. We can't cheaply probe-then-create because `stat`
      // reports NoSuchKey even when the *bucket* is missing, so "always create" is the robust path.
      const { url, headers } = await signPutBucket({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        region,
        nowIso: new Date().toISOString(),
      })
      const res = await fetch(url, { method: 'PUT', headers })
      // 200 = created, 409 BucketAlreadyOwnedByYou = already ours — both success. 403 = a
      // bucket-scoped credential (Railway/Tigris, R2 API tokens) that can't create buckets but
      // whose bucket is pre-provisioned out of band: tolerate it rather than refuse to boot —
      // a genuinely broken credential still surfaces on the first head/presign. Anything else
      // (misconfigured endpoint, 5xx) is a real failure and must abort startup.
      if (!res.ok && res.status !== 409 && res.status !== 403) {
        throw new Error(`Failed to create bucket "${bucket}": ${res.status} ${await res.text()}`)
      }
    },
  }
}

/** Build an RFC 6266 `attachment` Content-Disposition for a download. Emits an ASCII-sanitized
 * `filename=` (quotes/backslashes/control chars stripped) for legacy clients plus a
 * `filename*=UTF-8''…` form so non-ASCII names survive intact. */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Whether an S3 error means the *object* is absent (NoSuchKey / HTTP 404) — as opposed to a
 * missing bucket, auth, or transport error, which must not be mistaken for "not present". */
function isObjectNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false
  }
  const code = 'code' in err ? String((err as { code: unknown }).code) : ''
  const name = 'name' in err ? String((err as { name: unknown }).name) : ''
  return code === 'NoSuchKey' || name === 'NoSuchKey' || code === '404'
}

export { createS3BlobProvider }
