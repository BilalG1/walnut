import { describe, expect, test } from 'bun:test'
import { decodeJwt } from '../src/lib/auth/jwt.ts'

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
  return `${header}.${b64url(JSON.stringify(payload))}.signature`
}

describe('decodeJwt', () => {
  test('extracts sub, email, name, exp from the payload', () => {
    const token = makeJwt({ sub: 'user-1', email: 'a@b.com', name: 'Alice', exp: 123, role: 'authenticated' })
    expect(decodeJwt(token)).toEqual({ sub: 'user-1', email: 'a@b.com', name: 'Alice', exp: 123 })
  })

  test('omits claims that are the wrong type', () => {
    const token = makeJwt({ sub: 42, email: null })
    const claims = decodeJwt(token)
    expect(claims?.sub).toBeUndefined()
    expect(claims?.email).toBeUndefined()
  })

  test('returns null for a malformed token', () => {
    expect(decodeJwt('not-a-jwt')).toBeNull()
    expect(decodeJwt('only.two')).toBeNull()
    expect(decodeJwt('')).toBeNull()
  })
})
