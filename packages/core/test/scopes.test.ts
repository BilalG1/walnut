import { describe, expect, test } from 'bun:test'
import {
  ALL_SCOPES,
  isAgentScope,
  isScopeValidForResource,
  missingScopes,
  parseScopes,
  parseScopesForResource,
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
