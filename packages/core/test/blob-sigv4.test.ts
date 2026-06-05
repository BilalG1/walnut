import { describe, expect, test } from 'bun:test'
import { signPutBucket } from '../src/blob/sigv4.ts'

const BASE = {
  endpoint: 'http://localhost:3003',
  bucket: 'walnut',
  accessKeyId: 'walnut',
  secretAccessKey: 'walnutminio',
  region: 'us-east-1',
  nowIso: '2026-06-05T12:34:56.000Z',
}

describe('signPutBucket', () => {
  test('signs a path-style PUT to the bucket root (no trailing slash)', async () => {
    const { url, headers } = await signPutBucket(BASE)
    expect(url).toBe('http://localhost:3003/walnut')
    expect(headers['x-amz-date']).toBe('20260605T123456Z')
    expect(headers.host).toBe('localhost:3003')
    // Empty-body payload hash is the sha256 of the empty string.
    expect(headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('Authorization carries the right credential scope and signed headers', async () => {
    const { headers } = await signPutBucket(BASE)
    expect(headers.authorization).toContain('AWS4-HMAC-SHA256 Credential=walnut/20260605/us-east-1/s3/aws4_request')
    expect(headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date')
    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  test('is deterministic for fixed inputs and varies with the key', async () => {
    const a = await signPutBucket(BASE)
    const b = await signPutBucket(BASE)
    expect(a.headers.authorization).toBe(b.headers.authorization)
    const c = await signPutBucket({ ...BASE, secretAccessKey: 'different' })
    expect(c.headers.authorization).not.toBe(a.headers.authorization)
  })
})
