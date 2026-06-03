import { trimProbe } from '../core/paginate.ts'
import type {
  AdapterCapabilities,
  CellValue,
  ColumnMeta,
  DatabaseViewerAdapter,
  PageInfo,
  RowsRequest,
  RowsResult,
  TableRef,
} from '../types.ts'
import { buildCountQuery, buildRowsQuery, cursorKey, encodeCursor, type BuildRowsInput } from './build-sql.ts'
import { getColumns as introspectColumns, listTables as introspectTables } from './introspect.ts'
import type { RawResult, SqlRunner } from './runner.ts'
import { inferCellValue, toCellValue } from './typemap.ts'

export type { RawResult, SqlRunner } from './runner.ts'

export interface PostgresAdapterOptions {
  /** Executes a parameterized statement. See {@link SqlRunner}. */
  run: SqlRunner
  /** Schemas to expose in the table list. Defaults to `['public']`. */
  schemas?: string[]
  /** Hard cap on rows fetched per page, regardless of what the UI requests. Defaults to 1000. */
  maxPageSize?: number
}

const DEFAULT_MAX_PAGE_SIZE = 1000

/**
 * Build a {@link DatabaseViewerAdapter} backed by Postgres. It owns all dialect specifics —
 * introspection, identifier quoting, parameterized SQL building, and lossless value mapping —
 * but executes nothing itself: every statement goes through the injected `run`. That keeps the
 * adapter usable both client-side (posting to the gated `/sql` route) and server-side.
 */
export function createPostgresAdapter(options: PostgresAdapterOptions): DatabaseViewerAdapter {
  const { run } = options
  const schemas = options.schemas ?? ['public']
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE

  // Column metadata rarely changes within a session; cache it per table to avoid re-introspecting
  // on every page/sort/filter. Keyed by schema.name.
  const columnCache = new Map<string, ColumnMeta[]>()

  const capabilities: AdapterCapabilities = {
    cursor: true,
    totalCount: true,
    filters: true,
    rawSql: true,
    mutate: false,
    schemas,
  }

  async function ensureColumns(table: TableRef, signal: AbortSignal | undefined): Promise<ColumnMeta[]> {
    const key = `${table.schema}.${table.name}`
    const cached = columnCache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const columns = await introspectColumns(run, table, { signal })
    columnCache.set(key, columns)
    return columns
  }

  return {
    capabilities,

    async listTables(opts) {
      const scope = opts?.schema !== undefined ? [opts.schema] : schemas
      return introspectTables(run, scope, { signal: opts?.signal })
    },

    async getColumns(table, opts) {
      return ensureColumns(table, opts?.signal)
    },

    async getRows(request: RowsRequest): Promise<RowsResult> {
      const columns = await ensureColumns(request.table, request.signal)
      const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
      const limit = Math.min(Math.max(1, request.page.limit), maxPageSize)

      const input: BuildRowsInput = {
        table: request.table,
        allColumns: columns,
        request: { ...request, page: { ...request.page, limit } },
        pkColumns,
      }

      const built = buildRowsQuery(input)
      const result = await run(built.sql, built.params, { signal: request.signal })
      const probe = trimProbe(result.rows, limit)
      // A size-capped result can drop the over-fetch probe row (and more), which would make the
      // probe under-report `hasNext`. A truncated result always means there's more to show.
      const hasNext = probe.hasNext || result.truncated === true
      const pageRows = probe.rows
      const cellRows = pageRows.map((row) => built.selected.map((c) => toCellValue(c, row[c.name])))

      const total = await maybeCount(input, request, run)
      const page = buildPageInfo(request, pkColumns, pageRows, hasNext, total)
      return { columns, rows: cellRows, page }
    },

    async runSql(sql, opts): Promise<RowsResult> {
      const result = await run(sql, [], { signal: opts?.signal })
      return rawToResult(result)
    },
  }
}

/** Run the COUNT query only when an exact total was requested on an offset page. */
async function maybeCount(input: BuildRowsInput, request: RowsRequest, run: SqlRunner): Promise<number | null> {
  if (request.page.kind !== 'offset' || request.page.withTotal !== true) {
    return null
  }
  const countQuery = buildCountQuery(input)
  const result = await run(countQuery.sql, countQuery.params, { signal: request.signal })
  const raw = result.rows[0]?.count
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function buildPageInfo(
  request: RowsRequest,
  pkColumns: string[],
  pageRows: Record<string, unknown>[],
  hasNext: boolean,
  total: number | null,
): PageInfo {
  if (request.page.kind === 'cursor') {
    const key = cursorKey(request.sort, pkColumns)
    const last = pageRows[pageRows.length - 1]
    const nextCursor = hasNext && last !== undefined ? encodeCursor([last[key.column]]) : null
    return { total, hasNext, hasPrev: request.page.after != null, nextCursor }
  }
  return { total, hasNext, hasPrev: request.page.offset > 0 }
}

/** Map an untyped raw result (the escape hatch) into a RowsResult, inferring kinds from values. */
function rawToResult(result: RawResult): RowsResult {
  const columns: ColumnMeta[] = result.fields.map((name) => ({
    name,
    kind: 'unknown',
    udtName: '',
    nullable: true,
    isPrimaryKey: false,
    default: null,
    references: null,
  }))
  const rows: CellValue[][] = result.rows.map((row) => result.fields.map((name) => inferCellValue(row[name])))
  return { columns, rows, page: { total: rows.length, hasNext: false, hasPrev: false } }
}
