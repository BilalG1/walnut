import { describe, expect, test } from 'bun:test'
import { decodeJwt } from 'jose'
import { DEFAULT_LOCAL_EMAIL, createLocalAuth } from '../src/auth/local-auth.ts'

describe('local auth provider', () => {
  test('mints an access token the local verifier accepts, with stable identity', async () => {
    const auth = await createLocalAuth()
    const session = await auth.login()
    const claims = await auth.verifier.verify(session.accessToken)
    expect(claims.email).toBe(DEFAULT_LOCAL_EMAIL)
    // The user id is a deterministic UUIDv5 of the email — same email, same sub.
    expect(claims.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const again = await auth.login()
    const againClaims = await auth.verifier.verify(again.accessToken)
    expect(againClaims.userId).toBe(claims.userId)
  })

  test('access tokens carry a short-lived expiry', async () => {
    const auth = await createLocalAuth()
    const { accessToken } = await auth.login()
    const { iat, exp } = decodeJwt(accessToken)
    expect(typeof exp).toBe('number')
    expect(typeof iat).toBe('number')
    // ~1h TTL — never a permanent credential.
    expect((exp ?? 0) - (iat ?? 0)).toBe(3600)
  })

  test('distinct emails get distinct stable user ids', async () => {
    const auth = await createLocalAuth()
    const a = await auth.verifier.verify((await auth.login('alice@walnut.local')).accessToken)
    const b = await auth.verifier.verify((await auth.login('bob@walnut.local')).accessToken)
    expect(a.userId).not.toBe(b.userId)
    // Case/whitespace-insensitive: the same identity normalizes to the same id.
    const a2 = await auth.verifier.verify((await auth.login('  Alice@Walnut.local ')).accessToken)
    expect(a2.userId).toBe(a.userId)
  })

  test('refresh issues a new session for the same identity', async () => {
    const auth = await createLocalAuth()
    const session = await auth.login('carol@walnut.local')
    const refreshed = await auth.refresh(session.refreshToken)
    if (refreshed === null) {
      throw new Error('refresh returned null')
    }
    const before = await auth.verifier.verify(session.accessToken)
    const after = await auth.verifier.verify(refreshed.accessToken)
    expect(after.userId).toBe(before.userId)
    expect(after.email).toBe('carol@walnut.local')
  })

  test('refresh rejects garbage and access-token misuse', async () => {
    const auth = await createLocalAuth()
    const session = await auth.login()
    expect(await auth.refresh('not-a-jwt')).toBeNull()
    // An access token must not be usable as a refresh token (different audience).
    expect(await auth.refresh(session.accessToken)).toBeNull()
  })

  test('a refresh token is rejected by the access verifier (audience separation)', async () => {
    const auth = await createLocalAuth()
    const session = await auth.login()
    await expect(auth.verifier.verify(session.refreshToken)).rejects.toThrow()
  })
})
