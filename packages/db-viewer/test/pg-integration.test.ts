import { localPostgresUrl } from '@walnut/core/ports'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { formatCell } from '../src/core/format.ts'
import { createPostgresAdapter } from '../src/postgres/index.ts'
import type { SqlRunner } from '../src/postgres/runner.ts'
import type { CellValue, DatabaseViewerAdapter, RowsResult, TableRef } from '../src/types.ts'

/**
 * End-to-end coverage of the Postgres adapter against a real database — the only way to verify
 * introspection, lossless type mapping, ordering correctness across pages, and keyset/offset
 * equivalence. Sets up a throwaway `dbviewer_test` schema on the local docker Postgres (the same
 * instance the API e2e suite uses) and tears it down after. If Postgres isn't reachable the
 * suite no-ops rather than failing, mirroring how the rest of the repo treats the local DB.
 */

const SCHEMA = 'dbviewer_test'
const ADMIN_URL = localPostgresUrl({ database: 'postgres', prefix: process.env.PORT_PREFIX })

type Client = ReturnType<typeof postgres>
let client: Client
let adapter: DatabaseViewerAdapter
let available = false

const items: TableRef = { schema: SCHEMA, name: 'items', kind: 'table', estimatedRows: null }
const composite: TableRef = { schema: SCHEMA, name: 'composite', kind: 'table', estimatedRows: null }
const nopk: TableRef = { schema: SCHEMA, name: 'nopk', kind: 'table', estimatedRows: null }
const child: TableRef = { schema: SCHEMA, name: 'child', kind: 'table', estimatedRows: null }

beforeAll(async () => {
  client = postgres(ADMIN_URL, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 5 })
  try {
    await client.unsafe('SELECT 1')
  } catch {
    available = false
    return
  }
  available = true

  await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.unsafe(`CREATE SCHEMA ${SCHEMA}`)
  await client.unsafe(`CREATE TYPE ${SCHEMA}.mood AS ENUM ('happy', 'sad')`)
  await client.unsafe(`
    CREATE TABLE ${SCHEMA}.items (
      id bigint PRIMARY KEY,
      n int4,
      big int8,
      amount numeric,
      name text,
      flag boolean,
      uid uuid,
      created_at timestamptz,
      day date,
      payload jsonb,
      blob bytea,
      tags text[],
      mood ${SCHEMA}.mood,
      huge int8
    )
  `)
  // Row A — fully populated, with precision-sensitive and binary values.
  await client.unsafe(`
    INSERT INTO ${SCHEMA}.items VALUES
    (9, 5, 9, 1234567890123456789.0123456789, 'alice', true,
     '00000000-0000-0000-0000-000000000009', '2026-06-02 12:00:00+00', '2026-06-02',
     '{"a":1}', '\\xDEADBEEF', '{x,y}', 'happy', 9223372036854775807)
  `)
  // Row B — NULLs across the nullable columns; only id and big set.
  await client.unsafe(`INSERT INTO ${SCHEMA}.items (id, big) VALUES (10, 10)`)
  // Row C — empty-string name (distinct from NULL), bigger keys.
  await client.unsafe(`INSERT INTO ${SCHEMA}.items (id, big, name, flag) VALUES (100, 100, '', false)`)

  await client.unsafe(`
    CREATE TABLE ${SCHEMA}.composite (k1 int4, k2 int4, v text, PRIMARY KEY (k1, k2))
  `)
  await client.unsafe(`INSERT INTO ${SCHEMA}.composite VALUES (1, 1, 'a'), (1, 2, 'b'), (2, 1, 'c')`)

  // A composite foreign key — exercises position-paired FK introspection.
  await client.unsafe(`
    CREATE TABLE ${SCHEMA}.child (a int4, b int4, note text, FOREIGN KEY (a, b) REFERENCES ${SCHEMA}.composite (k1, k2))
  `)

  await client.unsafe(`CREATE TABLE ${SCHEMA}.nopk (a int4, b text)`)
  await client.unsafe(`INSERT INTO ${SCHEMA}.nopk VALUES (3, 'three'), (1, 'one'), (2, 'two')`)

  const run: SqlRunner = async (text, params) => {
    const result = await client.unsafe(text, params as never[])
    const rows = Array.from(result) as Record<string, unknown>[]
    const cols = (result as unknown as { columns?: { name: string }[] }).columns
    const fields = cols ? cols.map((c) => c.name) : rows[0] ? Object.keys(rows[0]) : []
    return { rows, fields }
  }
  adapter = createPostgresAdapter({ run, schemas: [SCHEMA] })
})

afterAll(async () => {
  if (client !== undefined) {
    if (available) {
      await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    }
    await client.end({ timeout: 5 })
  }
})

function cellAt(result: RowsResult, rowIndex: number, name: string): CellValue {
  const colIndex = result.columns.findIndex((c) => c.name === name)
  const cell = result.rows[rowIndex]?.[colIndex]
  if (cell === undefined) {
    throw new Error(`no cell for ${name} at row ${rowIndex}`)
  }
  return cell
}

function colValues(result: RowsResult, name: string): string[] {
  const colIndex = result.columns.findIndex((c) => c.name === name)
  return result.rows.map((row) => {
    const cell = row[colIndex]
    return cell === undefined ? '<none>' : formatCell(cell)
  })
}

describe('postgres adapter integration', () => {
  test('lists the schema tables', async () => {
    if (!available) {
      return
    }
    const tables = await adapter.listTables()
    const names = tables.map((t) => t.name).toSorted()
    expect(names).toEqual(['child', 'composite', 'items', 'nopk'])
    expect(tables.every((t) => t.schema === SCHEMA && t.kind === 'table')).toBe(true)
  })

  test('introspects a composite foreign key, pairing columns by position', async () => {
    if (!available) {
      return
    }
    const columns = await adapter.getColumns(child)
    const byName = new Map(columns.map((c) => [c.name, c]))
    // The information_schema join produced a cross-product here (a→k2, b→k1); the position-paired
    // pg_catalog query keeps a→k1 and b→k2.
    expect(byName.get('a')?.references).toEqual({ schema: SCHEMA, table: 'composite', column: 'k1' })
    expect(byName.get('b')?.references).toEqual({ schema: SCHEMA, table: 'composite', column: 'k2' })
    expect(byName.get('note')?.references).toBeNull()
  })

  test('introspects column kinds, the primary key, and nullability', async () => {
    if (!available) {
      return
    }
    const columns = await adapter.getColumns(items)
    const byName = new Map(columns.map((c) => [c.name, c]))
    expect(byName.get('id')?.isPrimaryKey).toBe(true)
    expect(byName.get('id')?.nullable).toBe(false)
    expect(byName.get('name')?.nullable).toBe(true)
    expect(byName.get('big')?.kind).toBe('bigint')
    expect(byName.get('amount')?.kind).toBe('bigint')
    expect(byName.get('n')?.kind).toBe('number')
    expect(byName.get('flag')?.kind).toBe('bool')
    expect(byName.get('uid')?.kind).toBe('uuid')
    expect(byName.get('created_at')?.kind).toBe('timestamp')
    expect(byName.get('created_at')?.udtName).toBe('timestamptz')
    expect(byName.get('day')?.kind).toBe('date')
    expect(byName.get('payload')?.kind).toBe('json')
    expect(byName.get('blob')?.kind).toBe('bytea')
    expect(byName.get('tags')?.kind).toBe('array')
    expect(byName.get('mood')?.kind).toBe('enum')
  })

  test('maps every value losslessly, keeping NULL distinct from empty string', async () => {
    if (!available) {
      return
    }
    // Default (no sort) orders by the PK: rows are id 9, 10, 100.
    const result = await adapter.getRows({ table: items, sort: [], page: { kind: 'offset', limit: 50, offset: 0 } })
    expect(colValues(result, 'id')).toEqual(['9', '10', '100'])

    // Row A — precision-sensitive and binary values survive intact.
    expect(cellAt(result, 0, 'amount')).toEqual({ k: 'bigint', v: '1234567890123456789.0123456789' })
    expect(cellAt(result, 0, 'huge')).toEqual({ k: 'bigint', v: '9223372036854775807' })
    expect(cellAt(result, 0, 'flag')).toEqual({ k: 'bool', v: true })
    expect(cellAt(result, 0, 'payload')).toEqual({ k: 'json', v: { a: 1 } })
    expect(cellAt(result, 0, 'mood')).toEqual({ k: 'enum', v: 'happy' })
    expect(cellAt(result, 0, 'tags')).toEqual({ k: 'array', v: [{ k: 'text', v: 'x' }, { k: 'text', v: 'y' }] })
    const blob = cellAt(result, 0, 'blob')
    expect(blob).toEqual({ k: 'bytea', base64: '3q2+7w==', bytes: 4 })
    const created = cellAt(result, 0, 'created_at')
    expect(created.k).toBe('timestamp')
    expect(created.k === 'timestamp' && created.tz).toBe(true)

    // Row B — a NULL name; Row C — an empty-string name. They must not collapse together.
    expect(cellAt(result, 1, 'name')).toEqual({ k: 'null' })
    expect(cellAt(result, 2, 'name')).toEqual({ k: 'text', v: '' })
  })

  test('orders a bigint column numerically, not lexically (the text-cast regression)', async () => {
    if (!available) {
      return
    }
    // Values 9, 10, 100 sort 100,10,9 numerically but 9,10,100 if compared as the text projection.
    const result = await adapter.getRows({
      table: items,
      sort: [{ column: 'big', direction: 'desc' }],
      page: { kind: 'offset', limit: 50, offset: 0 },
    })
    expect(colValues(result, 'big')).toEqual(['100', '10', '9'])
  })

  test('paginates with disjoint offset pages and an accurate hasNext', async () => {
    if (!available) {
      return
    }
    const page0 = await adapter.getRows({ table: items, sort: [], page: { kind: 'offset', limit: 2, offset: 0 } })
    expect(colValues(page0, 'id')).toEqual(['9', '10'])
    expect(page0.page.hasNext).toBe(true)
    expect(page0.page.hasPrev).toBe(false)

    const page1 = await adapter.getRows({ table: items, sort: [], page: { kind: 'offset', limit: 2, offset: 2 } })
    expect(colValues(page1, 'id')).toEqual(['100'])
    expect(page1.page.hasNext).toBe(false)
    expect(page1.page.hasPrev).toBe(true)
  })

  test('computes an exact total only when requested', async () => {
    if (!available) {
      return
    }
    const result = await adapter.getRows({
      table: items,
      sort: [],
      page: { kind: 'offset', limit: 2, offset: 0, withTotal: true },
    })
    expect(result.page.total).toBe(3)
  })

  test('keyset (cursor) paging visits the same rows as offset paging', async () => {
    if (!available) {
      return
    }
    const viaOffset: string[] = []
    for (let offset = 0; ; offset += 2) {
      // eslint-disable-next-line no-await-in-loop -- pages are inherently sequential
      const page = await adapter.getRows({ table: items, sort: [], page: { kind: 'offset', limit: 2, offset } })
      viaOffset.push(...colValues(page, 'id'))
      if (!page.page.hasNext) {
        break
      }
    }

    const viaCursor: string[] = []
    let after: string | null = null
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- each cursor depends on the previous page
      const page: RowsResult = await adapter.getRows({
        table: items,
        sort: [],
        page: { kind: 'cursor', limit: 2, after },
      })
      viaCursor.push(...colValues(page, 'id'))
      if (!page.page.hasNext) {
        break
      }
      after = page.page.nextCursor ?? null
    }

    expect(viaCursor).toEqual(viaOffset)
    expect(viaCursor).toEqual(['9', '10', '100'])
  })

  test('applies basic filters: eq, contains, and is_null', async () => {
    if (!available) {
      return
    }
    const page = { kind: 'offset', limit: 50, offset: 0 } as const

    const eq = await adapter.getRows({ table: items, sort: [], page, filters: [{ column: 'name', op: 'eq', value: 'alice' }] })
    expect(colValues(eq, 'id')).toEqual(['9'])

    const contains = await adapter.getRows({
      table: items,
      sort: [],
      page,
      filters: [{ column: 'name', op: 'contains', value: 'LIC' }],
    })
    expect(colValues(contains, 'id')).toEqual(['9'])

    const nulls = await adapter.getRows({ table: items, sort: [], page, filters: [{ column: 'name', op: 'is_null' }] })
    expect(colValues(nulls, 'id')).toEqual(['10'])
  })

  test('handles a composite primary key: offset works, cursor is refused', async () => {
    if (!available) {
      return
    }
    const cols = await adapter.getColumns(composite)
    expect(cols.filter((c) => c.isPrimaryKey).map((c) => c.name)).toEqual(['k1', 'k2'])

    const rows = await adapter.getRows({ table: composite, sort: [], page: { kind: 'offset', limit: 50, offset: 0 } })
    expect(colValues(rows, 'v')).toEqual(['a', 'b', 'c'])

    await expect(
      adapter.getRows({ table: composite, sort: [], page: { kind: 'cursor', limit: 2, after: null } }),
    ).rejects.toThrow('single-column primary key')
  })

  test('handles a table with no primary key', async () => {
    if (!available) {
      return
    }
    const cols = await adapter.getColumns(nopk)
    expect(cols.some((c) => c.isPrimaryKey)).toBe(false)

    const rows = await adapter.getRows({
      table: nopk,
      sort: [{ column: 'a', direction: 'asc' }],
      page: { kind: 'offset', limit: 50, offset: 0 },
    })
    expect(colValues(rows, 'a')).toEqual(['1', '2', '3'])
  })
})
