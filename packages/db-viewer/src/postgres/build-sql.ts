import type { ColumnMeta, Filter, RowsRequest, SortSpec, TableRef } from '../types.ts'
import { quoteIdent, quoteQualified } from './quote.ts'

/**
 * Turn a structured {@link RowsRequest} into parameterized SQL. Every value is a `$n`
 * placeholder (never interpolated); every identifier is validated against the table's
 * introspected columns and then quoted. The result is deterministic so it can be snapshot-
 * tested without a database.
 *
 * Columns are referenced through the table alias `t` (e.g. `t."id"`). This matters: the
 * projection casts some columns to text (`(t."id")::text AS "id"`), and an unqualified
 * `ORDER BY "id"` would bind to that text *output* column and sort a bigint lexically. The
 * `t.` prefix forces ordering against the real table column instead.
 */

const T = 't'

/** Reference a column on the table alias. */
function col(name: string): string {
  return `${T}.${quoteIdent(name)}`
}

/**
 * The SELECT-list expression for a column. The kinds that don't survive transport faithfully
 * — bigint/numeric (precision), timestamps/dates (driver Date ambiguity), bytea (binary),
 * and anything unrecognized — are cast to a stable text/base64 form here. Everything else is
 * selected raw (numbers, bools, json, uuid, text, enum, arrays all transport cleanly).
 */
export function projectionExpr(column: ColumnMeta): string {
  const ref = col(column.name)
  switch (column.kind) {
    case 'bigint':
    case 'timestamp':
    case 'date':
    case 'unknown':
      return `(${ref})::text`
    case 'bytea':
      return `encode(${ref}, 'base64')`
    default:
      return ref
  }
}

export interface BuildRowsInput {
  table: TableRef
  /** All introspected columns — used for validation and projection. */
  allColumns: ColumnMeta[]
  request: RowsRequest
  /** Primary-key column names (deterministic tiebreaker + keyset key). */
  pkColumns: string[]
}

export interface BuiltQuery {
  sql: string
  params: unknown[]
  /** Columns in projection order, so the adapter can map result rows positionally. */
  selected: ColumnMeta[]
}

/** Resolve which columns to select, preserving request order and rejecting unknown names. */
export function selectColumns(allColumns: ColumnMeta[], requested: string[] | undefined): ColumnMeta[] {
  if (requested === undefined) {
    return allColumns
  }
  const byName = new Map(allColumns.map((c) => [c.name, c]))
  return requested.map((name) => {
    const found = byName.get(name)
    if (found === undefined) {
      throw new Error(`unknown column: ${name}`)
    }
    return found
  })
}

/** A tiny parameter accumulator: `push(value)` records a value and returns its `$n` marker. */
function makeParams(): { push: (v: unknown) => string; values: unknown[] } {
  const values: unknown[] = []
  return {
    push(v) {
      values.push(v)
      return `$${values.length}`
    },
    values,
  }
}

export function buildRowsQuery(input: BuildRowsInput): BuiltQuery {
  const { table, allColumns, request, pkColumns } = input
  const byName = new Map(allColumns.map((c) => [c.name, c]))
  const selected = selectColumns(allColumns, request.columns)
  const { push, values } = makeParams()

  const projection = selected.map((c) => `${projectionExpr(c)} AS ${quoteIdent(c.name)}`).join(', ')
  const where: string[] = []

  for (const filter of request.filters ?? []) {
    const column = byName.get(filter.column)
    if (column === undefined) {
      throw new Error(`unknown filter column: ${filter.column}`)
    }
    where.push(buildPredicate(column, filter, push))
  }

  const limit = Math.max(1, request.page.limit)
  let orderBy: string

  if (request.page.kind === 'cursor') {
    const key = cursorKey(request.sort, pkColumns)
    if (request.page.after != null) {
      const value = decodeCursor(request.page.after)[0]
      // Cast the bound cursor value to the key column's type. The encoded value is the column's
      // text-cast projection (a string), so without this a driver that binds params as text
      // would fail with `operator does not exist: <type> > text`. Postgres.js happens to infer
      // it, but the cast makes the predicate correct under any SqlRunner.
      const keyMeta = byName.get(key.column)
      const cast = keyMeta !== undefined ? `::${quoteIdent(keyMeta.udtName)}` : ''
      where.push(`${col(key.column)} ${key.direction === 'desc' ? '<' : '>'} ${push(value)}${cast}`)
    }
    orderBy = `ORDER BY ${col(key.column)} ${key.direction === 'desc' ? 'DESC' : 'ASC'}`
  } else {
    orderBy = orderByClause(request.sort, byName, pkColumns)
    if (orderBy === '') {
      // No explicit sort AND no primary key → ORDER BY would be empty, leaving Postgres free to
      // return rows in any order, which makes offset pagination overlap/skip rows. Fall back to
      // ordering by the orderable selected columns (skipping json/unknown, which have no default
      // ordering operator) so paging is at least deterministic.
      const orderable = selected.filter((c) => c.kind !== 'json' && c.kind !== 'unknown')
      if (orderable.length > 0) {
        orderBy = `ORDER BY ${orderable.map((c) => col(c.name)).join(', ')}`
      }
    }
  }

  const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  // Over-fetch one row so the adapter can report `hasNext` without a COUNT.
  const tail =
    request.page.kind === 'offset'
      ? ` LIMIT ${limit + 1} OFFSET ${Math.max(0, request.page.offset)}`
      : ` LIMIT ${limit + 1}`

  const sql = `SELECT ${projection} FROM ${quoteQualified(table.schema, table.name)} AS ${T}${whereClause}${orderBy === '' ? '' : ` ${orderBy}`}${tail}`
  return { sql, params: values, selected }
}

/** A `SELECT count(*)` for the same filters, used when an exact total is requested. */
export function buildCountQuery(input: BuildRowsInput): { sql: string; params: unknown[] } {
  const { table, allColumns, request } = input
  const byName = new Map(allColumns.map((c) => [c.name, c]))
  const { push, values } = makeParams()
  const where: string[] = []
  for (const filter of request.filters ?? []) {
    const column = byName.get(filter.column)
    if (column === undefined) {
      throw new Error(`unknown filter column: ${filter.column}`)
    }
    where.push(buildPredicate(column, filter, push))
  }
  const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  const sql = `SELECT count(*)::text AS count FROM ${quoteQualified(table.schema, table.name)} AS ${T}${whereClause}`
  return { sql, params: values }
}

function orderByClause(sort: SortSpec[], byName: Map<string, ColumnMeta>, pkColumns: string[]): string {
  const terms: string[] = []
  const used = new Set<string>()
  for (const spec of sort) {
    if (!byName.has(spec.column)) {
      throw new Error(`unknown sort column: ${spec.column}`)
    }
    used.add(spec.column)
    terms.push(orderTerm(spec.column, spec.direction, spec.nulls))
  }
  // Append the primary key as a deterministic tiebreaker so pagination is stable across pages.
  for (const pk of pkColumns) {
    if (!used.has(pk)) {
      terms.push(`${col(pk)} ASC`)
      used.add(pk)
    }
  }
  return terms.length > 0 ? `ORDER BY ${terms.join(', ')}` : ''
}

function orderTerm(column: string, direction: 'asc' | 'desc', nulls: 'first' | 'last' | undefined): string {
  const dir = direction === 'desc' ? 'DESC' : 'ASC'
  const nullsClause = nulls === 'first' ? ' NULLS FIRST' : nulls === 'last' ? ' NULLS LAST' : ''
  return `${col(column)} ${dir}${nullsClause}`
}

function buildPredicate(column: ColumnMeta, filter: Filter, push: (v: unknown) => string): string {
  const ref = col(column.name)
  switch (filter.op) {
    case 'is_null':
      return `${ref} IS NULL`
    case 'is_not_null':
      return `${ref} IS NOT NULL`
    case 'eq':
      return `${ref} = ${push(filter.value ?? null)}`
    case 'ne':
      return `${ref} <> ${push(filter.value ?? null)}`
    case 'lt':
      return `${ref} < ${push(filter.value ?? null)}`
    case 'lte':
      return `${ref} <= ${push(filter.value ?? null)}`
    case 'gt':
      return `${ref} > ${push(filter.value ?? null)}`
    case 'gte':
      return `${ref} >= ${push(filter.value ?? null)}`
    case 'like':
      return `${ref}::text LIKE ${push(String(filter.value ?? ''))}`
    case 'ilike':
      return `${ref}::text ILIKE ${push(String(filter.value ?? ''))}`
    case 'contains':
      return buildContains(column, ref, filter.value, push)
    case 'in':
      return `${ref} = ANY(${push(asArray(filter.value))})`
  }
}

/**
 * `contains` is overloaded by kind: substring match for text (the default-skin use), and the
 * containment operator `@>` for json/array. Text matching escapes LIKE metacharacters so the
 * needle is treated literally.
 */
function buildContains(
  column: ColumnMeta,
  ref: string,
  value: Filter['value'],
  push: (v: unknown) => string,
): string {
  if (column.kind === 'json') {
    const json = typeof value === 'object' ? JSON.stringify(value) : String(value ?? null)
    return `${ref} @> ${push(json)}::jsonb`
  }
  if (column.kind === 'array') {
    return `${ref} @> ${push(asArray(value))}`
  }
  const needle = `%${escapeLike(String(value ?? ''))}%`
  return `${ref}::text ILIKE ${push(needle)}`
}

/** Escape LIKE/ILIKE metacharacters so a user's filter text matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1')
}

function asArray(value: Filter['value']): unknown[] {
  return Array.isArray(value) ? value : [value ?? null]
}

// --- Keyset cursors ---------------------------------------------------------------------

interface CursorKey {
  column: string
  direction: 'asc' | 'desc'
}

/**
 * Resolve the single key column for keyset pagination. v1 supports cursors only when the
 * ordering reduces to one unique column (a single-column primary key) — either no explicit
 * sort, or a sort that is exactly that PK. Anything richer must use offset paging.
 */
export function cursorKey(sort: SortSpec[], pkColumns: string[]): CursorKey {
  if (pkColumns.length !== 1) {
    throw new Error('cursor pagination requires a single-column primary key')
  }
  const pk = pkColumns[0]
  if (pk === undefined) {
    throw new Error('cursor pagination requires a single-column primary key')
  }
  if (sort.length === 0) {
    return { column: pk, direction: 'asc' }
  }
  if (sort.length === 1 && sort[0]?.column === pk) {
    return { column: pk, direction: sort[0].direction }
  }
  throw new Error('cursor pagination requires ordering by the single-column primary key')
}

/** Encode a boundary row's key values into an opaque cursor. */
export function encodeCursor(values: unknown[]): string {
  return base64Encode(JSON.stringify(values))
}

/** Decode a cursor back into its key values. Throws on a malformed cursor. */
export function decodeCursor(cursor: string): unknown[] {
  const parsed: unknown = JSON.parse(base64Decode(cursor))
  if (!Array.isArray(parsed)) {
    throw new Error('malformed cursor')
  }
  return parsed
}

function base64Encode(text: string): string {
  // btoa expects latin1; route through UTF-8 bytes so non-ASCII key values survive.
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
}

function base64Decode(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}
