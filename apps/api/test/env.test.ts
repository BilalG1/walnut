import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadEnv } from '../src/env.ts'

// loadEnv reads process.env directly, so each test sets exactly the vars it asserts on and
// the suite restores the original environment afterward. We clear every key loadEnv touches
// up front so ambient values (a developer's shell, a loaded .env) can't leak into a case.
const KEYS = [
  'NODE_ENV',
  'CORS_ORIGIN',
  'AUTH_DEV_BYPASS',
  'AUTH_PROVIDER',
  'HEXCLAVE_PROJECT_ID',
  'HEXCLAVE_SECRET_SERVER_KEY',
  'HEXCLAVE_API_BASE_URL',
  'DB_PROVIDER',
  'PORT_PREFIX',
  'PORT',
  'DATABASE_URL',
  'LOCAL_PG_ADMIN_URL',
  'NEON_API_KEY',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  // A Hexclave project id present by default, so most cases exercise hexclave auth mode.
  // (loadEnv needs no auth env at all — it falls back to local mode; the auth-mode suite
  // covers that explicitly.)
  process.env.HEXCLAVE_PROJECT_ID = 'proj_test'
})

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('loadEnv — CORS', () => {
  test('defaults to the local dashboard origin in dev', () => {
    const env = loadEnv()
    expect(env.corsOrigins).toEqual(['http://localhost:3000'])
  })

  test('parses a comma-separated allowlist, trimming blanks', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com, https://admin.example.com ,'
    expect(loadEnv().corsOrigins).toEqual(['https://app.example.com', 'https://admin.example.com'])
  })

  test('fails closed in production when CORS_ORIGIN is unset', () => {
    process.env.NODE_ENV = 'production'
    expect(() => loadEnv()).toThrow(/CORS_ORIGIN must be set/)
  })

  test('fails closed in production when CORS_ORIGIN is blank', () => {
    process.env.NODE_ENV = 'production'
    process.env.CORS_ORIGIN = '   '
    expect(() => loadEnv()).toThrow(/CORS_ORIGIN must be set/)
  })

  test('accepts an explicit allowlist in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.CORS_ORIGIN = 'https://app.example.com'
    expect(loadEnv().corsOrigins).toEqual(['https://app.example.com'])
  })
})

describe('loadEnv — dev-auth bypass', () => {
  test('enabled when AUTH_DEV_BYPASS is set outside production', () => {
    process.env.AUTH_DEV_BYPASS = '1'
    expect(loadEnv().devAuth.enabled).toBe(true)
  })

  test('disabled by default', () => {
    expect(loadEnv().devAuth.enabled).toBe(false)
  })

  test('refuses to boot when enabled in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.AUTH_DEV_BYPASS = '1'
    process.env.CORS_ORIGIN = 'https://app.example.com'
    expect(() => loadEnv()).toThrow(/AUTH_DEV_BYPASS must not be enabled/)
  })

  test('boots in production when the bypass is unset', () => {
    process.env.NODE_ENV = 'production'
    process.env.CORS_ORIGIN = 'https://app.example.com'
    expect(loadEnv().devAuth.enabled).toBe(false)
  })
})

describe('loadEnv — provider', () => {
  test('rejects an unknown DB_PROVIDER', () => {
    process.env.DB_PROVIDER = 'mysql'
    expect(() => loadEnv()).toThrow(/DB_PROVIDER must be/)
  })

})

describe('loadEnv — auth provider', () => {
  test('uses hexclave mode when a project id is set', () => {
    const auth = loadEnv().auth
    expect(auth.mode).toBe('hexclave')
    expect(auth.projectId).toBe('proj_test')
  })

  test('falls back to local mode when no Hexclave project id is configured', () => {
    delete process.env.HEXCLAVE_PROJECT_ID
    const auth = loadEnv().auth
    expect(auth.mode).toBe('local')
    expect(auth.projectId).toBeUndefined()
  })

  test('AUTH_PROVIDER=local forces local mode even with a project id present', () => {
    process.env.AUTH_PROVIDER = 'local'
    expect(loadEnv().auth.mode).toBe('local')
  })

  test('AUTH_PROVIDER=hexclave still requires HEXCLAVE_PROJECT_ID', () => {
    delete process.env.HEXCLAVE_PROJECT_ID
    process.env.AUTH_PROVIDER = 'hexclave'
    expect(() => loadEnv()).toThrow(/HEXCLAVE_PROJECT_ID/)
  })

  test('rejects an unknown AUTH_PROVIDER', () => {
    process.env.AUTH_PROVIDER = 'auth0'
    expect(() => loadEnv()).toThrow(/AUTH_PROVIDER must be/)
  })

  test('refuses to silently fall back to local auth in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.CORS_ORIGIN = 'https://app.example.com'
    delete process.env.HEXCLAVE_PROJECT_ID
    expect(() => loadEnv()).toThrow(/No auth configured in production/)
  })

  test('allows local auth in production when opted in explicitly', () => {
    process.env.NODE_ENV = 'production'
    process.env.CORS_ORIGIN = 'https://app.example.com'
    delete process.env.HEXCLAVE_PROJECT_ID
    process.env.AUTH_PROVIDER = 'local'
    expect(loadEnv().auth.mode).toBe('local')
  })
})
