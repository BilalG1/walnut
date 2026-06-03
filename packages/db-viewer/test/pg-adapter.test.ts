import { describe, expect, test } from 'bun:test'
import { createPostgresAdapter } from '../src/postgres/index.ts'
import { decodeCursor } from '../src/postgres/build-sql.ts'
import type { RawResult, SqlRunner } from '../src/postgres/runner.ts'
import type { TableRef } from '../src/types.ts'

const TABLE: TableRef = { schema: 'public', name: 'items', kind: 'table', estimatedRows: 3 }

interface Recorded {
  sql: string
  params: unknown[]
}

/**
 * A fake runner that routes by SQL shape to canned responses and records every call, so the
 * adapter can be exercised with no database. `data` is a function of the call count so tests
 * can vary the data page (e.g. the over-fetch probe row).
 */
function fakeRunner(opts: {
  tables?: RawResult
  columns?: RawResult
  pk?: RawResult
  fk?: RawResult
  count?: RawResult
  data?: (call: number) => RawResult
}): { run: SqlRunner; calls: Recorded[] } {
  const calls: Recorded[] = []
  let dataCall = 0
  const empty: RawResult = { rows: [], fields: [] }
  const run: SqlRunner = async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('reltuples')) return opts.tables ?? empty
    if (sql.includes('information_schema.columns')) return opts.columns ?? empty
    if (sql.includes('indisprimary')) return opts.pk ?? empty
    if (sql.includes('pg_constraint')) return opts.fk ?? empty
    if (sql.includes('count(*)')) return opts.count ?? empty
    dataCall += 1
    return opts.data ? opts.data(dataCall) : empty
  }
  return { run, calls }
}

const ITEM_COLUMNS: RawResult = {
  fields: ['name', 'data_type', 'udt_name', 'is_nullable', 'column_default', 'ordinal_position'],
  rows: [
    { name: 'id', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO', column_default: null, ordinal_position: 1 },
    { name: 'name', data_type: 'text', udt_name: 'text', is_nullable: 'YES', column_default: null, ordinal_position: 2 },
  ],
}
const ITEM_PK: RawResult = { fields: ['name'], rows: [{ name: 'id' }] }

describe('createPostgresAdapter — listTables', () => {
  test('maps relkind and estimated rows, treating reltuples=-1 as unknown', async () => {
    const { run } = fakeRunner({
      tables: {
        fields: ['schema', 'name', 'relkind', 'est'],
        rows: [
          { schema: 'public', name: 'items', relkind: 'r', est: 1234 },
          { schema: 'public', name: 'v_items', relkind: 'v', est: -1 },
          { schema: 'public', name: 'm_items', relkind: 'm', est: 5 },
        ],
      },
    })
    const adapter = createPostgresAdapter({ run })
    const tables = await adapter.listTables()
    expect(tables).toEqual([
      { schema: 'public', name: 'items', kind: 'table', estimatedRows: 1234 },
      { schema: 'public', name: 'v_items', kind: 'view', estimatedRows: null },
      { schema: 'public', name: 'm_items', kind: 'materialized_view', estimatedRows: 5 },
    ])
  })
})

describe('createPostgresAdapter — getColumns', () => {
  test('merges columns, primary key, and foreign keys', async () => {
    const { run } = fakeRunner({
      columns: ITEM_COLUMNS,
      pk: ITEM_PK,
      fk: {
        fields: ['name', 'ref_schema', 'ref_table', 'ref_column'],
        rows: [{ name: 'name', ref_schema: 'public', ref_table: 'owners', ref_column: 'handle' }],
      },
    })
    const adapter = createPostgresAdapter({ run })
    const cols = await adapter.getColumns(TABLE)
    expect(cols).toEqual([
      { name: 'id', kind: 'bigint', udtName: 'int8', nullable: false, isPrimaryKey: true, default: null, references: null },
      {
        name: 'name',
        kind: 'text',
        udtName: 'text',
        nullable: true,
        isPrimaryKey: false,
        default: null,
        references: { schema: 'public', table: 'owners', column: 'handle' },
      },
    ])
  })

  test('caches columns: a second lookup does not re-introspect', async () => {
    const { run, calls } = fakeRunner({ columns: ITEM_COLUMNS, pk: ITEM_PK })
    const adapter = createPostgresAdapter({ run })
    await adapter.getColumns(TABLE)
    await adapter.getColumns(TABLE)
    const columnQueries = calls.filter((c) => c.sql.includes('information_schema.columns'))
    expect(columnQueries).toHaveLength(1)
  })
})

describe('createPostgresAdapter — getRows', () => {
  function adapterWithRows(data: (call: number) => RawResult, count?: RawResult) {
    return fakeRunner({ columns: ITEM_COLUMNS, pk: ITEM_PK, count, data })
  }

  test('maps rows to lossless cells and trims the over-fetch probe into hasNext', async () => {
    const { run } = adapterWithRows(() => ({
      fields: ['id', 'name'],
      // 3 rows for a limit of 2 → the third is the probe.
      rows: [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
        { id: '3', name: 'c' },
      ],
    }))
    const adapter = createPostgresAdapter({ run })
    const result = await adapter.getRows({ table: TABLE, sort: [], page: { kind: 'offset', limit: 2, offset: 0 } })

    expect(result.rows).toEqual([
      [{ k: 'bigint', v: '1' }, { k: 'text', v: 'a' }],
      [{ k: 'bigint', v: '2' }, { k: 'text', v: 'b' }],
    ])
    expect(result.page.hasNext).toBe(true)
    expect(result.page.hasPrev).toBe(false)
    expect(result.page.total).toBeNull()
  })

  test('reports hasPrev once past the first page', async () => {
    const { run } = adapterWithRows(() => ({ fields: ['id', 'name'], rows: [{ id: '5', name: 'e' }] }))
    const adapter = createPostgresAdapter({ run })
    const result = await adapter.getRows({ table: TABLE, sort: [], page: { kind: 'offset', limit: 2, offset: 2 } })
    expect(result.page.hasPrev).toBe(true)
    expect(result.page.hasNext).toBe(false)
  })

  test('runs an exact count only when withTotal is set', async () => {
    const { run, calls } = adapterWithRows(
      () => ({ fields: ['id', 'name'], rows: [{ id: '1', name: 'a' }] }),
      { fields: ['count'], rows: [{ count: '42' }] },
    )
    const adapter = createPostgresAdapter({ run })
    const result = await adapter.getRows({
      table: TABLE,
      sort: [],
      page: { kind: 'offset', limit: 2, offset: 0, withTotal: true },
    })
    expect(result.page.total).toBe(42)
    expect(calls.some((c) => c.sql.includes('count(*)'))).toBe(true)
  })

  test('cursor mode returns a nextCursor encoding the last visible row key', async () => {
    const { run } = adapterWithRows(() => ({
      fields: ['id', 'name'],
      rows: [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
        { id: '3', name: 'c' },
      ],
    }))
    const adapter = createPostgresAdapter({ run })
    const result = await adapter.getRows({ table: TABLE, sort: [], page: { kind: 'cursor', limit: 2, after: null } })
    expect(result.page.hasNext).toBe(true)
    expect(result.page.nextCursor).toBeDefined()
    // The last *visible* row is id=2 (id=3 was the trimmed probe).
    expect(decodeCursor(result.page.nextCursor ?? '')).toEqual(['2'])
  })
})

describe('createPostgresAdapter — runSql escape hatch', () => {
  test('infers cell kinds from values for an untyped result', async () => {
    const adapter = createPostgresAdapter({
      run: async () => ({ fields: ['n', 'label', 'flag'], rows: [{ n: 7, label: 'x', flag: true }] }),
    })
    const result = await adapter.runSql?.('select 1')
    expect(result?.columns.map((c) => c.name)).toEqual(['n', 'label', 'flag'])
    expect(result?.rows).toEqual([[{ k: 'num', v: 7 }, { k: 'text', v: 'x' }, { k: 'bool', v: true }]])
  })
})

describe('createPostgresAdapter — capabilities', () => {
  test('advertises read-only feature support with mutate disabled', () => {
    const { run } = fakeRunner({})
    const adapter = createPostgresAdapter({ run, schemas: ['public', 'app'] })
    expect(adapter.capabilities).toEqual({
      cursor: true,
      totalCount: true,
      filters: true,
      rawSql: true,
      mutate: false,
      schemas: ['public', 'app'],
    })
  })
})
