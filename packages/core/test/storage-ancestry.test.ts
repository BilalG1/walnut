import { describe, expect, test } from 'bun:test'
import { branchAncestry } from '../src/storage/ancestry.ts'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

describe('branchAncestry', () => {
  test('a root branch is just itself', () => {
    expect(branchAncestry(A)).toEqual([A])
    expect(branchAncestry(A, [])).toEqual([A])
  })

  test('prepends self to the parent ancestry (nearest-first)', () => {
    expect(branchAncestry(B, [A])).toEqual([B, A])
    expect(branchAncestry(C, [B, A])).toEqual([C, B, A])
  })

  test('does not mutate the parent ancestry', () => {
    const parent = [B, A]
    branchAncestry(C, parent)
    expect(parent).toEqual([B, A])
  })

  test('rejects a cycle (self already in the parent chain)', () => {
    expect(() => branchAncestry(A, [B, A])).toThrow(/cycle/)
  })
})
