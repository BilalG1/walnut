/**
 * The data contract for the database viewer. Everything in this file is pure types —
 * no React, no Postgres, no runtime. The headless core, the default UI, and any adapter
 * (`@walnut/db-viewer/postgres` or a hand-rolled one) all commit to these shapes.
 *
 * Design notes:
 *  - The grid emits *structured intent* ({@link RowsRequest}) — it never builds SQL. An
 *    adapter turns intent into queries, so the component stays database-agnostic and safe.
 *  - Cell values are a tagged union ({@link CellValue}) so transport is lossless: bigints
 *    and numerics stay decimal strings, NULL is distinct from the empty string, and bytea
 *    survives as base64.
 */

/**
 * The logical category the renderer and SQL builder switch on. Deliberately coarse — many
 * concrete database types collapse to one kind (e.g. int2/int4/float8 → `number`).
 */
export type ColumnKind =
  | 'text'
  | 'number'
  | 'bigint'
  | 'bool'
  | 'json'
  | 'timestamp'
  | 'date'
  | 'uuid'
  | 'bytea'
  | 'array'
  | 'enum'
  | 'unknown'

/** A foreign-key target, when a column references another table. */
export interface ColumnReference {
  schema: string
  table: string
  column: string
}

/** A column's metadata, as introspected from the database. */
export interface ColumnMeta {
  name: string
  kind: ColumnKind
  /** Raw database type name, for tooltips / schema panel — e.g. `timestamptz`, `int8`, `jsonb`. */
  udtName: string
  nullable: boolean
  isPrimaryKey: boolean
  /** Default expression text, when the column has one. */
  default: string | null
  /** Foreign-key target, when this column references another table. */
  references: ColumnReference | null
}

export type TableKind = 'table' | 'view' | 'materialized_view' | 'foreign'

/** A reference to a table/view the viewer can browse. */
export interface TableRef {
  schema: string
  name: string
  kind: TableKind
  /** Planner row estimate (e.g. Postgres `reltuples`); approximate, null when unknown. */
  estimatedRows: number | null
}

/**
 * A single cell value, normalized by the adapter so the renderer never has to know the
 * underlying database types and nothing is lost in transport. The discriminant is `k`.
 */
export type CellValue =
  /** SQL NULL — deliberately distinct from `{ k: 'text', v: '' }`. */
  | { k: 'null' }
  | { k: 'text'; v: string }
  /** Safe-integer / float that round-trips through a JS number. */
  | { k: 'num'; v: number }
  /** int8 / numeric — kept as a decimal string so precision past 2^53 is never lost. */
  | { k: 'bigint'; v: string }
  | { k: 'bool'; v: boolean }
  /** json / jsonb — already parsed. */
  | { k: 'json'; v: unknown }
  /** A timestamp in ISO-ish text; `tz` marks `timestamptz` vs `timestamp`. */
  | { k: 'timestamp'; v: string; tz: boolean }
  | { k: 'date'; v: string }
  | { k: 'uuid'; v: string }
  /** Binary — base64-encoded, with the original byte length for display. */
  | { k: 'bytea'; base64: string; bytes: number }
  | { k: 'array'; v: CellValue[] }
  | { k: 'enum'; v: string }
  /** Last-resort fallback: the server's `::text` rendering of an unrecognized type. */
  | { k: 'unknown'; text: string }

/** One column of an ORDER BY, in priority order within {@link RowsRequest.sort}. */
export interface SortSpec {
  column: string
  direction: 'asc' | 'desc'
  /**
   * NULL ordering. When omitted the adapter uses the engine default
   * (Postgres: NULLS LAST for ASC, NULLS FIRST for DESC).
   */
  nulls?: 'first' | 'last'
}

/** Opaque keyset cursor — an adapter-encoded snapshot of a boundary row's sort key. */
export type Cursor = string

/**
 * How to page. `offset` is simple and universal; `cursor` is keyset pagination for large
 * tables and is only valid when the sort resolves to a unique ordering (a primary key).
 */
export type PageRequest =
  | { kind: 'offset'; limit: number; offset: number; withTotal?: boolean }
  | { kind: 'cursor'; limit: number; after?: Cursor | null }

/** A scalar a filter compares against. Kept loose (often a UI string); adapters coerce per kind. */
export type FilterInput = string | number | boolean | null

/**
 * The full operator vocabulary. The default skin only surfaces a basic subset
 * (`eq` / `contains` / `is_null`) in v1, but the contract is broad so adapters and a
 * richer UI can grow without a breaking change.
 */
export type FilterOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'contains'
  | 'is_null'
  | 'is_not_null'

/** A single WHERE predicate. Predicates within a request are AND-combined. */
export interface Filter {
  column: string
  op: FilterOp
  /** Present for value ops; omitted for `is_null` / `is_not_null`. `in` takes an array. */
  value?: FilterInput | FilterInput[]
}

/** A request for a page of rows from one table. */
export interface RowsRequest {
  table: TableRef
  /** Subset / order of columns to fetch; undefined = all columns. */
  columns?: string[]
  sort: SortSpec[]
  page: PageRequest
  filters?: Filter[]
  /** Cancellation — lets the host abort superseded fetches (rapid table/sort switching). */
  signal?: AbortSignal
}

/** Pagination metadata returned alongside a page of rows. */
export interface PageInfo {
  /** Exact total, when requested and computed; null otherwise. */
  total: number | null
  hasNext: boolean
  hasPrev: boolean
  /** Cursors for keyset paging, when the adapter supports it. */
  nextCursor?: Cursor | null
  prevCursor?: Cursor | null
}

/** A page of rows. `rows` is row-major and positionally aligned to `columns`. */
export interface RowsResult {
  columns: ColumnMeta[]
  rows: CellValue[][]
  page: PageInfo
}

/** What an adapter can do — lets the UI hide affordances the backend can't honor. */
export interface AdapterCapabilities {
  /** Keyset pagination available (requires a unique/PK ordering). */
  cursor: boolean
  /** Exact `COUNT(*)` supported when `withTotal` is set. */
  totalCount: boolean
  /** WHERE filtering supported. */
  filters: boolean
  /** Raw-SQL escape hatch available via {@link DatabaseViewerAdapter.runSql}. */
  rawSql: boolean
  /** Row mutation (edit/insert/delete). Always false in v1 — a reserved seam. */
  mutate: boolean
  /** Schemas the adapter exposes. */
  schemas: string[]
}

/**
 * Reserved editing seam — unimplemented in v1. Kept in the contract so adding row editing
 * later is not a breaking change. Row identity comes from {@link ColumnMeta.isPrimaryKey},
 * which the adapter already introspects.
 */
export interface RowMutation {
  table: TableRef
  /** Primary-key column → value identifying the row to change. */
  pk: Record<string, FilterInput>
  /** Column → new value. */
  set: Record<string, FilterInput | null>
}

/**
 * The interface a host implements (or obtains from `@walnut/db-viewer/postgres`). The grid
 * speaks only this — list tables, describe a table, fetch a page — plus optional seams.
 */
export interface DatabaseViewerAdapter {
  readonly capabilities: AdapterCapabilities
  listTables(opts?: { schema?: string; signal?: AbortSignal }): Promise<TableRef[]>
  getColumns(table: TableRef, opts?: { signal?: AbortSignal }): Promise<ColumnMeta[]>
  getRows(request: RowsRequest): Promise<RowsResult>
  /** Optional raw-SQL escape hatch backing the power-user query box. */
  runSql?(sql: string, opts?: { signal?: AbortSignal }): Promise<RowsResult>
  /** Reserved editing seam — not implemented in v1. */
  mutateRow?(mutation: RowMutation, opts?: { signal?: AbortSignal }): Promise<void>
}
