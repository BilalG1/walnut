/**
 * A minimal AWS SigV4 signer for the *one* request Bun's `S3Client` can't make: creating a
 * bucket (`PUT /<bucket>`). Bun handles every object operation (and presigning), but has no
 * bucket-create call, and presigning the bucket root signs `/<bucket>/` (trailing slash),
 * which S3/MinIO treat as an empty-key object PUT, not a create. So we sign the bare
 * `PUT /<bucket>` ourselves. Scoped to this single idempotent request — not a general signer.
 */

const ENC = new TextEncoder()
/** sha256 of the empty string — the payload hash for a bodyless PUT. */
const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** UTF-8 bytes of `s` in a fresh ArrayBuffer-backed view (WebCrypto's BufferSource wants an
 * `ArrayBuffer`, not the `ArrayBufferLike` that `TextEncoder.encode` is typed to return). */
function enc(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(ENC.encode(s))
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc(data))
  return toHex(new Uint8Array(digest))
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc(data)))
}

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  let out = ''
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}

/** Two SigV4 timestamps from an ISO instant: `YYYYMMDDTHHMMSSZ` and `YYYYMMDD`. */
function amzDates(nowIso: string): { amzDate: string; dateStamp: string } {
  const amzDate = `${nowIso.replace(/[:-]|\.\d{3}/g, '').slice(0, 15)}Z`
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

export interface PutBucketInput {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  /** Current instant as an ISO string (injectable for deterministic tests). */
  nowIso: string
}

/**
 * Build a fully SigV4-signed `PUT /<bucket>` request (path-style). Returns the URL and headers
 * to `fetch`. Idempotent at the server: an existing bucket yields 409 BucketAlreadyOwnedByYou,
 * which the caller treats as success.
 */
export async function signPutBucket(
  input: PutBucketInput,
): Promise<{ url: string; headers: Record<string, string> }> {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region, nowIso } = input
  const { amzDate, dateStamp } = amzDates(nowIso)
  const host = new URL(endpoint).host
  const canonicalUri = `/${bucket}`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}\nx-amz-date:${amzDate}\n`
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${EMPTY_PAYLOAD_SHA256}`

  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`

  const kDate = await hmac(enc(`AWS4${secretAccessKey}`), dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, stringToSign))

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url: `${endpoint.replace(/\/$/, '')}${canonicalUri}`,
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
      authorization,
    },
  }
}
