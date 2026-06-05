import { describe, expect, test } from 'bun:test'
import { isSha256, physicalKey, projectKeyPrefix, stagingKey } from '../src/blob/keys.ts'

const PROJ = '11111111-1111-1111-1111-111111111111'
const HASH = 'a'.repeat(64)

describe('isSha256', () => {
  test('accepts a 64-char lowercase hex digest', () => {
    expect(isSha256(HASH)).toBe(true)
    expect(isSha256('0123456789abcdef'.repeat(4))).toBe(true)
  })

  test('rejects wrong length, uppercase, and non-hex', () => {
    expect(isSha256('a'.repeat(63))).toBe(false)
    expect(isSha256('a'.repeat(65))).toBe(false)
    expect(isSha256('A'.repeat(64))).toBe(false)
    expect(isSha256(`${'a'.repeat(63)}g`)).toBe(false)
    expect(isSha256('')).toBe(false)
  })
})

describe('physicalKey', () => {
  test('is content-addressed and project-scoped', () => {
    expect(physicalKey(PROJ, HASH)).toBe(`${PROJ}/blobs/${HASH}`)
  })

  test('identical bytes in one project collapse to one key (free dedup)', () => {
    expect(physicalKey(PROJ, HASH)).toBe(physicalKey(PROJ, HASH))
  })

  test('the same bytes in different projects never share a key (no cross-tenant oracle)', () => {
    const other = '22222222-2222-2222-2222-222222222222'
    expect(physicalKey(PROJ, HASH)).not.toBe(physicalKey(other, HASH))
  })

  test('always lives under the project key prefix', () => {
    expect(physicalKey(PROJ, HASH).startsWith(projectKeyPrefix(PROJ))).toBe(true)
  })

  test('rejects a malformed digest so a bad hash cannot smuggle a traversing key', () => {
    expect(() => physicalKey(PROJ, '../etc/passwd')).toThrow()
    expect(() => physicalKey(PROJ, 'a'.repeat(63))).toThrow()
  })
})

describe('stagingKey', () => {
  test('is project-scoped and segregated from committed blobs', () => {
    const key = stagingKey(PROJ, 'abc-123')
    expect(key).toBe(`${PROJ}/staging/abc-123`)
    expect(key.startsWith(projectKeyPrefix(PROJ))).toBe(true)
    expect(key.includes('/blobs/')).toBe(false)
  })
})
