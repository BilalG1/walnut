import { describe, expect, test } from 'bun:test'
import { resourceTargetLabel, scopeLabel, timeAgo } from '../src/lib/format.ts'

describe('scopeLabel', () => {
  test('maps known scopes to short labels', () => {
    expect(scopeLabel('db:read')).toBe('Read')
    expect(scopeLabel('db:write')).toBe('Write')
    expect(scopeLabel('db:delete')).toBe('Delete')
    expect(scopeLabel('db:ddl')).toBe('Schema')
    expect(scopeLabel('branch:create')).toBe('Create branch')
  })

  test('passes through unknown scopes', () => {
    expect(scopeLabel('email:send')).toBe('email:send')
  })
})

describe('resourceTargetLabel', () => {
  test('uses the resolved project name for a project target', () => {
    expect(resourceTargetLabel('project', 'analytics')).toBe('analytics')
  })

  test('falls back to a dash when a project name is unknown', () => {
    expect(resourceTargetLabel('project', null)).toBe('—')
  })

  test('labels org and branch targets', () => {
    expect(resourceTargetLabel('org', null)).toBe('the organization')
    expect(resourceTargetLabel('branch', 'analytics')).toBe('analytics')
    expect(resourceTargetLabel('branch', null)).toBe('a branch')
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-05-31T12:00:00Z').getTime()

  test('formats seconds, minutes, hours and days', () => {
    expect(timeAgo('2026-05-31T11:59:30Z', now)).toBe('30s ago')
    expect(timeAgo('2026-05-31T11:30:00Z', now)).toBe('30m ago')
    expect(timeAgo('2026-05-31T09:00:00Z', now)).toBe('3h ago')
    expect(timeAgo('2026-05-29T12:00:00Z', now)).toBe('2d ago')
  })

  test('returns empty string for invalid input', () => {
    expect(timeAgo('not-a-date', now)).toBe('')
  })
})
