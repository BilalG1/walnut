import { describe, expect, test } from 'bun:test'
import {
  ALL_SCOPES,
  effectiveScopes,
  isAgentScope,
  isScopeValidForResource,
  missingScopes,
  parseScopes,
  parseScopesForResource,
  sameScopeSet,
  SCOPES_BY_RESOURCE,
} from '../src/scopes.ts'

describe('scopes', () => {
  test('isAgentScope recognises known scopes only', () => {
    expect(isAgentScope('db:read')).toBe(true)
    expect(isAgentScope('db:ddl')).toBe(true)
    expect(isAgentScope('db:nonsense')).toBe(false)
    expect(isAgentScope('')).toBe(false)
  })

  test('parseScopes dedupes and returns display order', () => {
    expect(parseScopes(['db:write', 'db:read', 'db:write'])).toEqual(['db:read', 'db:write'])
    expect(parseScopes([...ALL_SCOPES])).toEqual([...ALL_SCOPES])
  })

  test('parseScopes throws on unknown scope', () => {
    expect(() => parseScopes(['db:read', 'db:bogus'])).toThrow(/Unknown scope/)
  })

  test('missingScopes returns required scopes not held, in order', () => {
    expect(missingScopes(['db:read'], ['db:read', 'db:write'])).toEqual(['db:write'])
    expect(missingScopes([], ['db:ddl', 'db:read'])).toEqual(['db:read', 'db:ddl'])
    expect(missingScopes(['db:read', 'db:write'], ['db:read'])).toEqual([])
  })
})

describe('scope expiry', () => {
  const now = new Date('2026-06-02T12:00:00Z')
  const past = new Date(now.getTime() - 1000)
  const future = new Date(now.getTime() + 3600_000)

  test('effectiveScopes keeps permanent and not-yet-expired scopes, drops expired', () => {
    expect(
      effectiveScopes(
        [
          { scope: 'db:read', expiresAt: null },
          { scope: 'db:write', expiresAt: future },
          { scope: 'db:delete', expiresAt: past },
        ],
        now,
      ),
    ).toEqual(['db:read', 'db:write'])
  })

  test('effectiveScopes returns display order regardless of input order, deduped', () => {
    expect(
      effectiveScopes(
        [
          { scope: 'db:ddl', expiresAt: null },
          { scope: 'db:read', expiresAt: future },
        ],
        now,
      ),
    ).toEqual(['db:read', 'db:ddl'])
  })

  test('a scope exactly at its deadline is expired (strictly-future check)', () => {
    expect(effectiveScopes([{ scope: 'db:read', expiresAt: now }], now)).toEqual([])
  })

  test('sameScopeSet compares canonical lists; null snapshot never matches', () => {
    expect(sameScopeSet(['db:read', 'db:write'], ['db:read', 'db:write'])).toBe(true)
    expect(sameScopeSet(['db:read'], ['db:read', 'db:write'])).toBe(false)
    expect(sameScopeSet(null, [])).toBe(false)
    expect(sameScopeSet([], [])).toBe(true)
  })
})

describe('scopes by resource', () => {
  test('db scopes are grantable at project and branch, not org', () => {
    expect(SCOPES_BY_RESOURCE.project).toEqual([...ALL_SCOPES])
    expect(SCOPES_BY_RESOURCE.branch).toEqual([...ALL_SCOPES])
    expect(SCOPES_BY_RESOURCE.org).toEqual([])
  })

  test('isScopeValidForResource gates db scopes by level', () => {
    expect(isScopeValidForResource('project', 'db:read')).toBe(true)
    expect(isScopeValidForResource('branch', 'db:ddl')).toBe(true)
    expect(isScopeValidForResource('org', 'db:read')).toBe(false)
  })

  test('parseScopesForResource accepts and normalises valid project/branch scopes', () => {
    expect(parseScopesForResource('project', ['db:write', 'db:read'])).toEqual(['db:read', 'db:write'])
    expect(parseScopesForResource('branch', ['db:read'])).toEqual(['db:read'])
  })

  test('parseScopesForResource rejects db scopes at the org level', () => {
    expect(() => parseScopesForResource('org', ['db:read'])).toThrow(/cannot be granted at the "org" level/)
  })

  test('parseScopesForResource still rejects unknown scopes', () => {
    expect(() => parseScopesForResource('project', ['db:bogus'])).toThrow(/Unknown scope/)
  })
})
