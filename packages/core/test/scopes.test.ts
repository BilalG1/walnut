import { describe, expect, test } from 'bun:test'
import { ALL_SCOPES, isAgentScope, missingScopes, parseScopes } from '../src/scopes.ts'

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
