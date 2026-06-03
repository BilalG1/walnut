import { describe, expect, test } from 'bun:test'
import { formatCount } from '../src/ui/util.ts'

describe('formatCount', () => {
  test('shows exact counts with separators below 10k', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount(9999)).toBe('9,999')
  })

  test('compacts to K and M', () => {
    expect(formatCount(10_000)).toBe('10K')
    expect(formatCount(12_345)).toBe('12.3K')
    expect(formatCount(2_500_000)).toBe('2.5M')
  })

  test('rounds 999,999 up to 1M rather than the nonsensical 1000K', () => {
    expect(formatCount(999_999)).toBe('1M')
  })

  test('rounds fractionals and treats negative / non-finite as unknown (empty)', () => {
    expect(formatCount(1234.7)).toBe('1,235')
    expect(formatCount(-1)).toBe('')
    expect(formatCount(Number.NaN)).toBe('')
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('')
  })
})
