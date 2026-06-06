import { describe, expect, test } from 'bun:test'
import { base64ByteLength, base64ToHex, formatBytea, formatCell, isNull, stringifyJson } from '../src/core/format.ts'
import type { CellValue } from '../src/types.ts'

describe('formatCell', () => {
  test('renders NULL distinctly from an empty string', () => {
    expect(formatCell({ k: 'null' })).toBe('NULL')
    expect(formatCell({ k: 'text', v: '' })).toBe('')
    expect(isNull({ k: 'null' })).toBe(true)
    expect(isNull({ k: 'text', v: '' })).toBe(false)
  })

  test('passes text through verbatim, including unicode and control chars', () => {
    expect(formatCell({ k: 'text', v: 'héllo 世界 🎉' })).toBe('héllo 世界 🎉')
    expect(formatCell({ k: 'text', v: 'a\tb\nc' })).toBe('a\tb\nc')
  })

  test('renders numbers and keeps bigints/numerics as exact strings', () => {
    expect(formatCell({ k: 'num', v: 42 })).toBe('42')
    expect(formatCell({ k: 'num', v: -3.5 })).toBe('-3.5')
    expect(formatCell({ k: 'num', v: 0 })).toBe('0')
    // The whole point of the bigint kind: no precision loss past 2^53.
    expect(formatCell({ k: 'bigint', v: '9223372036854775807' })).toBe('9223372036854775807')
    expect(formatCell({ k: 'bigint', v: '-12345678901234567890.0000001' })).toBe('-12345678901234567890.0000001')
  })

  test('renders booleans, uuids, enums, dates and timestamps', () => {
    expect(formatCell({ k: 'bool', v: true })).toBe('true')
    expect(formatCell({ k: 'bool', v: false })).toBe('false')
    expect(formatCell({ k: 'uuid', v: '00000000-0000-0000-0000-000000000001' })).toBe(
      '00000000-0000-0000-0000-000000000001',
    )
    expect(formatCell({ k: 'enum', v: 'active' })).toBe('active')
    expect(formatCell({ k: 'date', v: '2026-06-02' })).toBe('2026-06-02')
    expect(formatCell({ k: 'timestamp', v: '2026-06-02 12:00:00+00', tz: true })).toBe('2026-06-02 12:00:00+00')
  })

  test('renders json compactly and arrays with bracket notation', () => {
    expect(formatCell({ k: 'json', v: { a: 1, b: [true, null] } })).toBe('{"a":1,"b":[true,null]}')
    const arr: CellValue = {
      k: 'array',
      v: [
        { k: 'num', v: 1 },
        { k: 'null' },
        { k: 'text', v: 'x' },
      ],
    }
    expect(formatCell(arr)).toBe('[1, NULL, x]')
    expect(formatCell({ k: 'array', v: [] })).toBe('[]')
  })

  test('renders bytea as a hex preview plus byte count', () => {
    // base64 "AAEC" decodes to bytes 00 01 02.
    expect(formatCell({ k: 'bytea', base64: 'AAEC', bytes: 3 })).toBe('\\x000102… (3 bytes)')
    expect(formatCell({ k: 'bytea', base64: '', bytes: 0 })).toBe('\\x (0 bytes)')
    expect(formatBytea('AA==', 1)).toBe('\\x00… (1 byte)')
  })

  test('falls back to raw text for unknown kinds', () => {
    expect(formatCell({ k: 'unknown', text: '(1,2)' })).toBe('(1,2)')
  })
})

describe('stringifyJson', () => {
  test('handles nested structures and stays single-line', () => {
    expect(stringifyJson([1, { x: 'y' }])).toBe('[1,{"x":"y"}]')
  })

  test('never throws on values JSON.stringify cannot represent', () => {
    expect(stringifyJson(undefined)).toBe('undefined')
  })
})

describe('base64 helpers', () => {
  test('base64ToHex decodes a bounded prefix', () => {
    expect(base64ToHex('AAEC', 8)).toBe('000102')
    expect(base64ToHex('AAEC', 2)).toBe('0001')
    expect(base64ToHex('', 8)).toBe('')
    // maxBytes 0 must decode nothing (the limit check used to fire one byte too late).
    expect(base64ToHex('AAEC', 0)).toBe('')
  })

  test('base64ByteLength accounts for padding', () => {
    expect(base64ByteLength('AAEC')).toBe(3) // no padding
    expect(base64ByteLength('AA==')).toBe(1) // two pad chars
    expect(base64ByteLength('AAE=')).toBe(2) // one pad char
    expect(base64ByteLength('')).toBe(0)
  })
})
