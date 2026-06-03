import { describe, expect, test } from 'bun:test'
import { quoteIdent, quoteQualified } from '../src/postgres/quote.ts'

describe('quoteIdent', () => {
  test('wraps a plain identifier in double quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
  })

  test('preserves mixed case (which would otherwise be folded)', () => {
    expect(quoteIdent('userId')).toBe('"userId"')
  })

  test('quotes reserved words safely', () => {
    expect(quoteIdent('select')).toBe('"select"')
    expect(quoteIdent('order')).toBe('"order"')
  })

  test('neutralizes an embedded double-quote injection by doubling it', () => {
    // A naive builder would let this break out of the identifier; doubling keeps it inert.
    expect(quoteIdent('a" ; DROP TABLE users; --')).toBe('"a"" ; DROP TABLE users; --"')
  })

  test('rejects a NUL byte', () => {
    const withNul = `a${String.fromCharCode(0)}b`
    expect(() => quoteIdent(withNul)).toThrow('null byte')
  })
})

describe('quoteQualified', () => {
  test('quotes both schema and name', () => {
    expect(quoteQualified('public', 'agents')).toBe('"public"."agents"')
  })
})
