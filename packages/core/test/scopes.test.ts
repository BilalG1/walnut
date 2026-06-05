import { describe, expect, test } from 'bun:test'
import {
  ALL_SCOPES,
  effectiveScopes,
  isAgentScope,
  isScopeValidForResource,
  missingScopes,
  parseScopes,
  parseScopesForResource,
  scopeMask,
  scopeSetKey,
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

  test('scopeMask is the canonical bitmask of the db scopes (order/dup independent)', () => {
    expect(scopeMask([])).toBe(0)
    expect(scopeMask(['db:read'])).toBe(1)
    expect(scopeMask(['db:write'])).toBe(2)
    expect(scopeMask(['db:delete'])).toBe(4)
    expect(scopeMask(['db:ddl'])).toBe(8)
    expect(scopeMask(['db:read', 'db:write', 'db:delete', 'db:ddl'])).toBe(15)
    // Order and duplicates don't change the mask — the whole point of a canonical key.
    expect(scopeMask(['db:write', 'db:read'])).toBe(scopeMask(['db:read', 'db:write', 'db:read']))
  })

  test('scopeSetKey maps a scope set to a stable string; empty set is "0"', () => {
    expect(scopeSetKey([])).toBe('0')
    expect(scopeSetKey(['db:read'])).toBe('1')
    expect(scopeSetKey(['db:read', 'db:write'])).toBe('3')
    // Distinct sets never collide; equal sets (any order) share a key.
    expect(scopeSetKey(['db:read', 'db:ddl'])).toBe(scopeSetKey(['db:ddl', 'db:read']))
    expect(scopeSetKey(['db:read'])).not.toBe(scopeSetKey(['db:write']))
  })
})

describe('scopes by resource', () => {
  test('db scopes are grantable at project and branch, not org; branch:create everywhere', () => {
    expect(SCOPES_BY_RESOURCE.project).toEqual([...ALL_SCOPES])
    expect(SCOPES_BY_RESOURCE.branch).toEqual([...ALL_SCOPES])
    // The org level grants only the non-database branch:create (no db scope — no database there).
    expect(SCOPES_BY_RESOURCE.org).toEqual(['branch:create'])
  })

  test('isScopeValidForResource gates db scopes by level', () => {
    expect(isScopeValidForResource('project', 'db:read')).toBe(true)
    expect(isScopeValidForResource('branch', 'db:ddl')).toBe(true)
    expect(isScopeValidForResource('org', 'db:read')).toBe(false)
  })

  test('branch:create is grantable at every resource level', () => {
    expect(isScopeValidForResource('org', 'branch:create')).toBe(true)
    expect(isScopeValidForResource('project', 'branch:create')).toBe(true)
    expect(isScopeValidForResource('branch', 'branch:create')).toBe(true)
  })

  test('parseScopesForResource accepts and normalises valid project/branch scopes', () => {
    expect(parseScopesForResource('project', ['db:write', 'db:read'])).toEqual(['db:read', 'db:write'])
    expect(parseScopesForResource('branch', ['db:read'])).toEqual(['db:read'])
  })

  test('parseScopesForResource accepts branch:create at the org level', () => {
    expect(parseScopesForResource('org', ['branch:create'])).toEqual(['branch:create'])
  })

  test('parseScopesForResource rejects db scopes at the org level', () => {
    expect(() => parseScopesForResource('org', ['db:read'])).toThrow(/cannot be granted at the "org" level/)
  })

  test('parseScopesForResource still rejects unknown scopes', () => {
    expect(() => parseScopesForResource('project', ['db:bogus'])).toThrow(/Unknown scope/)
  })
})

describe('non-database scopes (branch:create)', () => {
  test('branch:create carries no engine bit — it never widens the scope-set key', () => {
    expect(scopeMask(['branch:create'])).toBe(0)
    expect(scopeSetKey(['branch:create'])).toBe('0')
    // Alongside db scopes it's transparent: the key is exactly the db scopes' key.
    expect(scopeSetKey(['db:read', 'branch:create'])).toBe(scopeSetKey(['db:read']))
  })

  test('effectiveScopes carries branch:create through expiry like any other scope', () => {
    const now = new Date('2026-06-02T12:00:00Z')
    const future = new Date(now.getTime() + 3600_000)
    const past = new Date(now.getTime() - 1000)
    expect(effectiveScopes([{ scope: 'branch:create', expiresAt: future }], now)).toEqual(['branch:create'])
    expect(effectiveScopes([{ scope: 'branch:create', expiresAt: past }], now)).toEqual([])
  })
})
