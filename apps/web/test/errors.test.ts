import { describe, expect, test } from 'bun:test'
import { readErrorBody } from '../src/lib/errors.ts'

describe('readErrorBody', () => {
  test('extracts a full insufficient-scope body', () => {
    const body = readErrorBody({
      error: 'insufficient_scope',
      message: 'needs db:write',
      missingScopes: ['db:write'],
      requiredScopes: ['db:write'],
      grantedScopes: ['db:read'],
    })
    expect(body.error).toBe('insufficient_scope')
    expect(body.message).toBe('needs db:write')
    expect(body.missingScopes).toEqual(['db:write'])
    expect(body.grantedScopes).toEqual(['db:read'])
  })

  test('ignores non-string array entries', () => {
    const body = readErrorBody({ error: 'x', message: 'y', missingScopes: ['db:read', 42, null] })
    expect(body.missingScopes).toEqual(['db:read'])
  })

  test('falls back for string and null values', () => {
    expect(readErrorBody('boom').message).toBe('boom')
    expect(readErrorBody(null).message).toBe('Request failed.')
    expect(readErrorBody(undefined).message).toBe('Request failed.')
  })
})
