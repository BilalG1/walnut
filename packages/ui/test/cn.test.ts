import { describe, expect, test } from 'bun:test'
import { cn } from '../src/lib/cn.ts'

describe('cn', () => {
  test('joins truthy values and skips falsy ones', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  test('flattens nested arrays and applies object maps', () => {
    expect(cn('a', ['b', ['c']], { d: true, e: false })).toBe('a b c d')
  })
})
