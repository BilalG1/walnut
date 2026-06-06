import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { authConfig } from '../src/lib/auth/config.ts'
import { refreshAccessToken } from '../src/lib/auth/session.ts'
import { clearTokens, getTokens, setTokens } from '../src/lib/auth/tokens.ts'

const realFetch = globalThis.fetch
const realLocalAuth = authConfig.localAuth

afterEach(() => {
  globalThis.fetch = realFetch
  authConfig.localAuth = realLocalAuth
  clearTokens()
})

function stubFetch(impl: () => Promise<Response>): void {
  globalThis.fetch = (() => impl()) as unknown as typeof fetch
}

describe('refreshAccessToken — hexclave', () => {
  beforeEach(() => {
    authConfig.localAuth = false
  })

  test('applies rotated tokens on success', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => Response.json({ access_token: 'a2', refresh_token: 'r2' }))
    expect(await refreshAccessToken()).toBe('a2')
    expect(getTokens()).toEqual({ accessToken: 'a2', refreshToken: 'r2' })
  })

  test('keeps the refresh token when none is returned', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => Response.json({ access_token: 'a2' }))
    expect(await refreshAccessToken()).toBe('a2')
    expect(getTokens()).toEqual({ accessToken: 'a2', refreshToken: 'r' })
  })

  test('returns null when there is no refresh token', async () => {
    expect(await refreshAccessToken()).toBeNull()
  })

  test('returns null on a rejected refresh and leaves the session untouched', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => new Response('nope', { status: 400 }))
    expect(await refreshAccessToken()).toBeNull()
    expect(getTokens()).toEqual({ accessToken: 'a', refreshToken: 'r' })
  })

  test('does not resurrect a session signed out mid-refresh', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => {
      clearTokens() // user signs out while the refresh is in flight
      return Response.json({ access_token: 'a2', refresh_token: 'r2' })
    })
    expect(await refreshAccessToken()).toBeNull()
    expect(getTokens()).toBeNull()
  })
})

describe('refreshAccessToken — local', () => {
  beforeEach(() => {
    authConfig.localAuth = true
  })

  test('applies rotated tokens on success (camelCase contract)', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => Response.json({ accessToken: 'a2', refreshToken: 'r2' }))
    expect(await refreshAccessToken()).toBe('a2')
    expect(getTokens()).toEqual({ accessToken: 'a2', refreshToken: 'r2' })
  })

  test('keeps the refresh token when none is returned', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => Response.json({ accessToken: 'a2' }))
    expect(await refreshAccessToken()).toBe('a2')
    expect(getTokens()).toEqual({ accessToken: 'a2', refreshToken: 'r' })
  })

  test('returns null on a rejected refresh and leaves the session untouched', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => new Response('nope', { status: 401 }))
    expect(await refreshAccessToken()).toBeNull()
    expect(getTokens()).toEqual({ accessToken: 'a', refreshToken: 'r' })
  })

  test('does not resurrect a session signed out mid-refresh', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    stubFetch(async () => {
      clearTokens()
      return Response.json({ accessToken: 'a2', refreshToken: 'r2' })
    })
    expect(await refreshAccessToken()).toBeNull()
    expect(getTokens()).toBeNull()
  })
})
