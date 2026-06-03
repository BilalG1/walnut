import { describe, expect, test } from 'bun:test'
import {
  buildCountQuery,
  buildRowsQuery,
  cursorKey,
  decodeCursor,
  encodeCursor,
  escapeLike,
  projectionExpr,
  selectColumns,
  type BuildRowsInput,
} from '../src/postgres/build-sql.ts'
import type { ColumnMeta, Filter, PageRequest, RowsRequest, SortSpec, TableRef } from '../src/types.ts'

const TABLE: TableRef = { schema: 'public', name: 't1', kind: 'table', estimatedRows: 0 }

function meta(name: string, kind: ColumnMeta['kind'], extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, kind, udtName: kind, nullable: true, isPrimaryKey: false, default: null, references: null, ...extra }
}

const COLUMNS: ColumnMeta[] = [
  meta('id', 'bigint', { isPrimaryKey: true, nullable: false, udtName: 'int8' }),
  meta('name', 'text', { udtName: 'text' }),
  meta('score', 'number', { udtName: 'int4' }),
  meta('data', 'json', { udtName: 'jsonb' }),
  meta('photo', 'bytea', { udtName: 'bytea' }),
  meta('created_at', 'timestamp', { udtName: 'timestamptz' }),
  meta('tags', 'array', { udtName: '_text' }),
]

function input(request: Partial<RowsRequest>, pkColumns = ['id']): BuildRowsInput {
  const page: PageRequest = request.page ?? { kind: 'offset', limit: 50, offset: 0 }
  return {
    table: TABLE,
    allColumns: COLUMNS,
    pkColumns,
    request: { table: TABLE, sort: [], page, ...request },
  }
}

describe('projectionExpr', () => {
  test('casts the precision/transport-sensitive kinds, selects the rest raw', () => {
    expect(projectionExpr(meta('id', 'bigint'))).toBe('(t."id")::text')
    expect(projectionExpr(meta('created_at', 'timestamp'))).toBe('(t."created_at")::text')
    expect(projectionExpr(meta('d', 'date'))).toBe('(t."d")::text')
    expect(projectionExpr(meta('x', 'unknown'))).toBe('(t."x")::text')
    expect(projectionExpr(meta('photo', 'bytea'))).toBe("encode(t.\"photo\", 'base64')")
    expect(projectionExpr(meta('score', 'number'))).toBe('t."score"')
    expect(projectionExpr(meta('data', 'json'))).toBe('t."data"')
    expect(projectionExpr(meta('tags', 'array'))).toBe('t."tags"')
  })
})

describe('selectColumns', () => {
  test('returns all columns when none requested', () => {
    expect(selectColumns(COLUMNS, undefined)).toHaveLength(COLUMNS.length)
  })

  test('preserves requested order and rejects unknown names', () => {
    expect(selectColumns(COLUMNS, ['name', 'id']).map((c) => c.name)).toEqual(['name', 'id'])
    expect(() => selectColumns(COLUMNS, ['nope'])).toThrow('unknown column: nope')
  })
})

describe('buildRowsQuery — projection, ordering, paging', () => {
  test('basic offset page orders by the PK tiebreaker and over-fetches by one', () => {
    const { sql, params } = buildRowsQuery(input({ columns: ['id', 'name'] }))
    expect(sql).toBe(
      'SELECT (t."id")::text AS "id", t."name" AS "name" FROM "public"."t1" AS t ORDER BY t."id" ASC LIMIT 51 OFFSET 0',
    )
    expect(params).toEqual([])
  })

  test('orders by the bigint column itself, not its text-cast output alias', () => {
    // Regression guard: the projection aliases (t."id")::text AS "id"; ordering must bind to
    // the real column (t."id") so a bigint sorts numerically, not lexically.
    const sort: SortSpec[] = [{ column: 'id', direction: 'desc' }]
    const { sql } = buildRowsQuery(input({ columns: ['id'], sort }))
    expect(sql).toContain('ORDER BY t."id" DESC')
    expect(sql).not.toContain('ORDER BY "id"')
  })

  test('honors multi-column sort and NULLS placement, appending the PK tiebreaker', () => {
    const sort: SortSpec[] = [
      { column: 'name', direction: 'asc', nulls: 'last' },
      { column: 'score', direction: 'desc' },
    ]
    const { sql } = buildRowsQuery(input({ columns: ['id'], sort }))
    expect(sql).toContain('ORDER BY t."name" ASC NULLS LAST, t."score" DESC, t."id" ASC')
  })

  test('does not duplicate the PK in ORDER BY when the sort already includes it', () => {
    const sort: SortSpec[] = [{ column: 'id', direction: 'asc' }]
    const { sql } = buildRowsQuery(input({ columns: ['id'], sort }))
    expect(sql).toContain('ORDER BY t."id" ASC LIMIT')
  })

  test('uses the requested offset', () => {
    const { sql } = buildRowsQuery(input({ columns: ['id'], page: { kind: 'offset', limit: 25, offset: 75 } }))
    expect(sql).toContain('LIMIT 26 OFFSET 75')
  })

  test('throws on an unknown sort column rather than emitting it', () => {
    expect(() => buildRowsQuery(input({ sort: [{ column: 'evil', direction: 'asc' }] }))).toThrow(
      'unknown sort column: evil',
    )
  })

  test('no sort and no primary key falls back to ordering by the orderable columns', () => {
    // pkColumns = [] (no PK). Without a fallback the query would have no ORDER BY → unstable paging.
    // json ("data") has no default ordering operator, so it's excluded; the LIMIT boundary
    // confirms the ORDER BY ends right after the orderable columns.
    const { sql } = buildRowsQuery(input({ columns: ['id', 'name', 'data'] }, []))
    expect(sql).toContain('ORDER BY t."id", t."name" LIMIT')
  })
})

describe('buildRowsQuery — filters are parameterized', () => {
  function whereOf(filters: Filter[]): { sql: string; params: unknown[] } {
    return buildRowsQuery(input({ columns: ['id'], filters }))
  }

  test('eq / ne / comparison operators bind a placeholder', () => {
    const { sql, params } = whereOf([{ column: 'name', op: 'eq', value: 'walnut' }])
    expect(sql).toContain('WHERE t."name" = $1 ORDER BY')
    expect(params).toEqual(['walnut'])
  })

  test('is_null / is_not_null take no parameter', () => {
    const r1 = whereOf([{ column: 'name', op: 'is_null' }])
    expect(r1.sql).toContain('WHERE t."name" IS NULL')
    expect(r1.params).toEqual([])
    const r2 = whereOf([{ column: 'data', op: 'is_not_null' }])
    expect(r2.sql).toContain('WHERE t."data" IS NOT NULL')
  })

  test('contains on text becomes a literal-escaped ILIKE', () => {
    const { sql, params } = whereOf([{ column: 'name', op: 'contains', value: 'a%_b' }])
    expect(sql).toContain('WHERE t."name"::text ILIKE $1')
    expect(params).toEqual(['%a\\%\\_b%'])
  })

  test('contains on json uses the @> containment operator', () => {
    const { sql, params } = whereOf([{ column: 'data', op: 'contains', value: '{"a":1}' }])
    expect(sql).toContain('WHERE t."data" @> $1::jsonb')
    expect(params).toEqual(['{"a":1}'])
  })

  test('in binds an array parameter via = ANY()', () => {
    const { sql, params } = whereOf([{ column: 'id', op: 'in', value: [1, 2, 3] }])
    expect(sql).toContain('WHERE t."id" = ANY($1)')
    expect(params).toEqual([[1, 2, 3]])
  })

  test('multiple filters are AND-combined with sequential placeholders', () => {
    const { sql, params } = whereOf([
      { column: 'name', op: 'eq', value: 'x' },
      { column: 'score', op: 'gte', value: 10 },
    ])
    expect(sql).toContain('WHERE t."name" = $1 AND t."score" >= $2')
    expect(params).toEqual(['x', 10])
  })

  test('a SQL-injection attempt in a value is inert (it is just a bound parameter)', () => {
    const evil = "x'; DROP TABLE users; --"
    const { sql, params } = whereOf([{ column: 'name', op: 'eq', value: evil }])
    expect(sql).toContain('WHERE t."name" = $1')
    expect(sql).not.toContain('DROP TABLE')
    expect(params).toEqual([evil])
  })

  test('a filter on an unknown column throws instead of reaching SQL', () => {
    expect(() => whereOf([{ column: 'evil"; DROP', op: 'eq', value: 1 }])).toThrow('unknown filter column')
  })
})

describe('escapeLike', () => {
  test('escapes the LIKE metacharacters', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\')
    expect(escapeLike('plain')).toBe('plain')
  })
})

describe('buildCountQuery', () => {
  test('counts with the same WHERE, no ORDER/LIMIT', () => {
    const { sql, params } = buildCountQuery(input({ filters: [{ column: 'name', op: 'eq', value: 'x' }] }))
    expect(sql).toBe('SELECT count(*)::text AS count FROM "public"."t1" AS t WHERE t."name" = $1')
    expect(params).toEqual(['x'])
  })
})

describe('keyset cursors', () => {
  test('cursorKey resolves to the single PK for an empty or PK-only sort', () => {
    expect(cursorKey([], ['id'])).toEqual({ column: 'id', direction: 'asc' })
    expect(cursorKey([{ column: 'id', direction: 'desc' }], ['id'])).toEqual({ column: 'id', direction: 'desc' })
  })

  test('cursorKey rejects multi-column PKs and non-PK orderings', () => {
    expect(() => cursorKey([], ['a', 'b'])).toThrow('single-column primary key')
    expect(() => cursorKey([{ column: 'name', direction: 'asc' }], ['id'])).toThrow('single-column primary key')
  })

  test('a first cursor page has no keyset predicate', () => {
    const { sql, params } = buildRowsQuery(input({ columns: ['id'], page: { kind: 'cursor', limit: 50, after: null } }))
    expect(sql).toBe('SELECT (t."id")::text AS "id" FROM "public"."t1" AS t ORDER BY t."id" ASC LIMIT 51')
    expect(params).toEqual([])
  })

  test('a subsequent ascending cursor page adds a > predicate cast to the key type', () => {
    const after = encodeCursor(['100'])
    const { sql, params } = buildRowsQuery(input({ columns: ['id'], page: { kind: 'cursor', limit: 50, after } }))
    // The cast (`::"int8"`) makes the keyset predicate correct even under a driver that binds
    // params as text (the cursor value is the column's text-cast projection).
    expect(sql).toContain('WHERE t."id" > $1::"int8"')
    expect(sql).toContain('ORDER BY t."id" ASC')
    expect(params).toEqual(['100'])
  })

  test('a descending cursor page adds a < predicate', () => {
    const after = encodeCursor(['100'])
    const sort: SortSpec[] = [{ column: 'id', direction: 'desc' }]
    const { sql } = buildRowsQuery(input({ columns: ['id'], sort, page: { kind: 'cursor', limit: 50, after } }))
    expect(sql).toContain('WHERE t."id" < $1')
    expect(sql).toContain('ORDER BY t."id" DESC')
  })

  test('encode/decode round-trips, including unicode key values', () => {
    expect(decodeCursor(encodeCursor(['100']))).toEqual(['100'])
    expect(decodeCursor(encodeCursor(['héllo 世界']))).toEqual(['héllo 世界'])
    expect(() => decodeCursor(encodeCursor('not-an-array' as unknown as string[]))).toThrow('malformed cursor')
  })
})
