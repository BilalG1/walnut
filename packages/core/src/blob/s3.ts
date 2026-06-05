import { signPutBucket } from './sigv4.ts'
import type { BlobHead, BlobProvider, BlobProviderConfig, PresignOptions, PresignPutOptions } from './types.ts'

/**
 * The one S3-speaking `BlobProvider` implementation, shared by the `local` (MinIO) and `r2`
 * providers — they differ only in config (endpoint/credentials), so prod and local exercise
 * the exact same code path. Built on Bun's native `S3Client` (presign/stat/delete), so there
 * is no external AWS SDK dependency.
 *
 * Path-style addressing (`virtualHostedStyle: false`) — MinIO needs it, and R2 supports it —
 * so a single endpoint form works for both.
 */
function createS3BlobProvider(config: BlobProviderConfig): BlobProvider {
  const { kind, endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto' } = config
  const client = new Bun.S3Client({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    virtualHostedStyle: false,
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
      return client.presign(key, { method: 'GET', expiresIn: options.expiresInSeconds })
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
      if (!res.ok && res.status !== 409) {
        throw new Error(`Failed to create bucket "${bucket}": ${res.status} ${await res.text()}`)
      }
    },
  }
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
