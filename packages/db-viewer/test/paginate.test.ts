import { describe, expect, test } from 'bun:test'
import { clampOffset, firstOffsetPage, pageCount, pageNumber, trimProbe } from '../src/core/paginate.ts'

describe('firstOffsetPage', () => {
  test('starts at offset 0 with the given limit', () => {
    expect(firstOffsetPage(50)).toEqual({ kind: 'offset', limit: 50, offset: 0, withTotal: false })
  })
})

describe('clampOffset', () => {
  test('never goes negative', () => {
    expect(clampOffset(-10, 25, null)).toBe(0)
  })

  test('passes through when the total is unknown', () => {
    expect(clampOffset(1000, 25, null)).toBe(1000)
  })

  test('clamps to the last page start when the total is known', () => {
    // 90 rows, page size 25 → pages start at 0,25,50,75; last is 75.
    expect(clampOffset(999, 25, 90)).toBe(75)
    expect(clampOffset(60, 25, 90)).toBe(60)
  })

  test('collapses to 0 for an empty table', () => {
    expect(clampOffset(40, 25, 0)).toBe(0)
  })

  test('handles an exact page-boundary total', () => {
    // 50 rows, page size 25 → last page starts at 25.
    expect(clampOffset(999, 25, 50)).toBe(25)
  })
})

describe('pageNumber / pageCount', () => {
  test('pageNumber is 1-based', () => {
    expect(pageNumber(0, 25)).toBe(1)
    expect(pageNumber(25, 25)).toBe(2)
    expect(pageNumber(49, 25)).toBe(2)
  })

  test('pageCount is at least 1 even when empty', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(1, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
  })
})

describe('trimProbe', () => {
  test('reports another page and drops the probe row when over-fetched', () => {
    const { rows, hasNext } = trimProbe([1, 2, 3, 4], 3)
    expect(rows).toEqual([1, 2, 3])
    expect(hasNext).toBe(true)
  })

  test('reports no next page when the probe row is absent', () => {
    const { rows, hasNext } = trimProbe([1, 2], 3)
    expect(rows).toEqual([1, 2])
    expect(hasNext).toBe(false)
  })

  test('drops everything beyond the limit defensively', () => {
    const { rows, hasNext } = trimProbe([1, 2, 3, 4, 5], 2)
    expect(rows).toEqual([1, 2])
    expect(hasNext).toBe(true)
  })
})
