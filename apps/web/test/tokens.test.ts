import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getTokens,
  setAccessToken,
  setTokens,
  subscribe,
} from '../src/lib/auth/tokens.ts'

afterEach(() => {
  clearTokens()
})

describe('token store', () => {
  test('stores and reads access + refresh tokens', () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    expect(getAccessToken()).toBe('a1')
    expect(getRefreshToken()).toBe('r1')
    expect(getTokens()).toEqual({ accessToken: 'a1', refreshToken: 'r1' })
    expect(localStorage.getItem('walnut.accessToken')).toBe('a1')
  })

  test('clearTokens removes the session', () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    clearTokens()
    expect(getTokens()).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('walnut.accessToken')).toBeNull()
  })

  test('setAccessToken rotates the access token but keeps the refresh token', () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    setAccessToken('a2')
    expect(getAccessToken()).toBe('a2')
    expect(getRefreshToken()).toBe('r1')
  })

  test('setAccessToken is a no-op when there is no session', () => {
    setAccessToken('a2')
    expect(getAccessToken()).toBeNull()
  })

  test('subscribers fire on sign-in and sign-out, not on token rotation', () => {
    let calls = 0
    const unsubscribe = subscribe(() => {
      calls += 1
    })
    setTokens({ accessToken: 'a1', refreshToken: 'r1' }) // +1
    setAccessToken('a2') // +0 (identity unchanged)
    clearTokens() // +1
    unsubscribe()
    setTokens({ accessToken: 'a3', refreshToken: 'r3' }) // ignored after unsubscribe
    expect(calls).toBe(2)
  })
})
