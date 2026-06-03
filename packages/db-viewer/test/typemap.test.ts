import { describe, expect, test } from 'bun:test'
import { inferCellValue, isTimestamptz, kindFromUdt, toCellValue } from '../src/postgres/typemap.ts'
import type { ColumnMeta } from '../src/types.ts'

function column(partial: Partial<ColumnMeta> & Pick<ColumnMeta, 'kind' | 'udtName'>): ColumnMeta {
  return {
    name: 'c',
    nullable: true,
    isPrimaryKey: false,
    default: null,
    references: null,
    ...partial,
  }
}

describe('kindFromUdt', () => {
  test('collapses integer/float types to number', () => {
    expect(kindFromUdt('integer', 'int4')).toBe('number')
    expect(kindFromUdt('smallint', 'int2')).toBe('number')
    expect(kindFromUdt('double precision', 'float8')).toBe('number')
  })

  test('maps int8 and numeric to bigint (precision-preserving)', () => {
    expect(kindFromUdt('bigint', 'int8')).toBe('bigint')
    expect(kindFromUdt('numeric', 'numeric')).toBe('bigint')
  })

  test('maps the obvious scalar types', () => {
    expect(kindFromUdt('boolean', 'bool')).toBe('bool')
    expect(kindFromUdt('uuid', 'uuid')).toBe('uuid')
    expect(kindFromUdt('jsonb', 'jsonb')).toBe('json')
    expect(kindFromUdt('bytea', 'bytea')).toBe('bytea')
    expect(kindFromUdt('date', 'date')).toBe('date')
    expect(kindFromUdt('text', 'text')).toBe('text')
    expect(kindFromUdt('character varying', 'varchar')).toBe('text')
  })

  test('maps both timestamp variants to timestamp and detects tz', () => {
    expect(kindFromUdt('timestamp without time zone', 'timestamp')).toBe('timestamp')
    expect(kindFromUdt('timestamp with time zone', 'timestamptz')).toBe('timestamp')
    expect(isTimestamptz('timestamptz')).toBe(true)
    expect(isTimestamptz('timestamp')).toBe(false)
  })

  test('arrays win regardless of element type', () => {
    expect(kindFromUdt('ARRAY', '_int4')).toBe('array')
    expect(kindFromUdt('ARRAY', '_text')).toBe('array')
  })

  test('user-defined types are treated as enums, otherwise unknown', () => {
    expect(kindFromUdt('USER-DEFINED', 'mood')).toBe('enum')
    expect(kindFromUdt('point', 'point')).toBe('unknown')
  })
})

describe('toCellValue', () => {
  test('null and undefined both become the null cell', () => {
    expect(toCellValue(column({ kind: 'text', udtName: 'text' }), null)).toEqual({ k: 'null' })
    expect(toCellValue(column({ kind: 'text', udtName: 'text' }), undefined)).toEqual({ k: 'null' })
  })

  test('empty string stays a text cell, distinct from null', () => {
    expect(toCellValue(column({ kind: 'text', udtName: 'text' }), '')).toEqual({ k: 'text', v: '' })
  })

  test('bigint keeps its exact string form', () => {
    expect(toCellValue(column({ kind: 'bigint', udtName: 'int8' }), '9223372036854775807')).toEqual({
      k: 'bigint',
      v: '9223372036854775807',
    })
  })

  test('number coerces a string-encoded value', () => {
    expect(toCellValue(column({ kind: 'number', udtName: 'int4' }), 5)).toEqual({ k: 'num', v: 5 })
    expect(toCellValue(column({ kind: 'number', udtName: 'float8' }), '2.5')).toEqual({ k: 'num', v: 2.5 })
  })

  test('bool accepts driver variants', () => {
    expect(toCellValue(column({ kind: 'bool', udtName: 'bool' }), true)).toEqual({ k: 'bool', v: true })
    expect(toCellValue(column({ kind: 'bool', udtName: 'bool' }), 't')).toEqual({ k: 'bool', v: true })
    expect(toCellValue(column({ kind: 'bool', udtName: 'bool' }), 'false')).toEqual({ k: 'bool', v: false })
  })

  test('json parses a string or passes an object through', () => {
    expect(toCellValue(column({ kind: 'json', udtName: 'jsonb' }), '{"a":1}')).toEqual({ k: 'json', v: { a: 1 } })
    expect(toCellValue(column({ kind: 'json', udtName: 'jsonb' }), { a: 1 })).toEqual({ k: 'json', v: { a: 1 } })
    // Invalid JSON string degrades to the raw string rather than throwing.
    expect(toCellValue(column({ kind: 'json', udtName: 'jsonb' }), 'not json')).toEqual({ k: 'json', v: 'not json' })
  })

  test('timestamp carries the tz flag from the column udt', () => {
    expect(toCellValue(column({ kind: 'timestamp', udtName: 'timestamptz' }), '2026-06-02 00:00:00+00')).toEqual({
      k: 'timestamp',
      v: '2026-06-02 00:00:00+00',
      tz: true,
    })
  })

  test('bytea computes byte length from base64', () => {
    expect(toCellValue(column({ kind: 'bytea', udtName: 'bytea' }), 'AAEC')).toEqual({
      k: 'bytea',
      base64: 'AAEC',
      bytes: 3,
    })
  })

  test('array maps each element by its runtime type, including nulls', () => {
    expect(toCellValue(column({ kind: 'array', udtName: '_int4' }), [1, null, 3])).toEqual({
      k: 'array',
      v: [{ k: 'num', v: 1 }, { k: 'null' }, { k: 'num', v: 3 }],
    })
  })

  test('array given a non-array (driver string literal) degrades to unknown', () => {
    expect(toCellValue(column({ kind: 'array', udtName: '_int4' }), '{1,2}')).toEqual({ k: 'unknown', text: '{1,2}' })
  })
})

describe('inferCellValue', () => {
  test('types values from their JS runtime type', () => {
    expect(inferCellValue(null)).toEqual({ k: 'null' })
    expect(inferCellValue(3)).toEqual({ k: 'num', v: 3 })
    expect(inferCellValue(true)).toEqual({ k: 'bool', v: true })
    expect(inferCellValue('x')).toEqual({ k: 'text', v: 'x' })
    expect(inferCellValue({ a: 1 })).toEqual({ k: 'json', v: { a: 1 } })
    expect(inferCellValue(10n)).toEqual({ k: 'bigint', v: '10' })
  })

  test('maps native Date and byte arrays losslessly (array elements / raw escape hatch)', () => {
    // Without explicit handling these fall into the `object → json` bucket and render garbled.
    expect(inferCellValue(new Date('2026-06-02T12:00:00.000Z'))).toEqual({
      k: 'timestamp',
      v: '2026-06-02T12:00:00.000Z',
      tz: true,
    })
    expect(inferCellValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toEqual({
      k: 'bytea',
      base64: '3q2+7w==',
      bytes: 4,
    })
  })
})
