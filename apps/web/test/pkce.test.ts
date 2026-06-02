import { describe, expect, test } from 'bun:test'
import { computeCodeChallenge, generateCodeVerifier, generateState } from '../src/lib/auth/pkce.ts'

describe('pkce', () => {
  test('computeCodeChallenge matches the RFC 7636 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await computeCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  test('generateCodeVerifier returns a 43-char base64url string', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('generateState returns a base64url string, unique per call', () => {
    const a = generateState()
    const b = generateState()
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a).not.toBe(b)
  })
})
