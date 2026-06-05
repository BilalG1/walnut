import { describe, expect, test } from 'bun:test'
import { scopeTone, statusTone } from '../src/lib/tones.ts'

describe('statusTone', () => {
  test('maps known statuses and falls back to neutral', () => {
    expect(statusTone('active')).toBe('emerald')
    expect(statusTone('provisioning')).toBe('amber')
    expect(statusTone('error')).toBe('red')
    expect(statusTone('whatever')).toBe('neutral')
  })
})

describe('scopeTone', () => {
  test('risk-codes db scopes', () => {
    expect(scopeTone('db:read')).toBe('emerald')
    expect(scopeTone('db:write')).toBe('amber')
    expect(scopeTone('db:delete')).toBe('red')
    expect(scopeTone('db:ddl')).toBe('purple')
    expect(scopeTone('db:unknown')).toBe('neutral')
  })

  test('non-database scopes get a distinct tone off the db risk scale', () => {
    expect(scopeTone('branch:create')).toBe('indigo')
  })
})
