import postgres from 'postgres'
import { byteLength, QUERY_LIMITS } from './limits.ts'

export interface QueryResult {
  /** Result rows as plain objects (empty for non-returning statements). Capped to the
   * configured row/byte ceilings — see {@link truncated}. */
  rows: Record<string, unknown>[]
  /** Rows returned or affected, as reported by Postgres — the *true* count, even when
   * {@link rows} was truncated below it. */
  rowCount: number
  /** The command tag, e.g. `SELECT`, `INSERT`, `CREATE TABLE`. */
  command: string | null
  /** Column names in result order. */
  fields: string[]
  /** True when {@link rows} was cut to fit the row/byte ceiling, so fewer rows are present
   * than `rowCount` — a default-LIMIT signal, not an error. */
  truncated: boolean
}

interface PgResultMeta {
  count: number
  command: string
  columns?: { name: string }[] | null
}

/**
 * Run a raw SQL string against a provisioned database over a short-lived
 * connection. Scope enforcement happens *before* this is ever called — this
 * function assumes the statement has already been authorised.
 *
 * `params` binds positional placeholders (`$1`, `$2`, …). When omitted, the
 * statement runs over the simple query protocol, which (unlike the parameterized
 * path) permits multiple statements — the agent query path relies on that, so
 * the no-param call is preserved exactly.
 *
 * `options.readOnly` makes the session read-only (`SET SESSION CHARACTERISTICS AS TRANSACTION
 * READ ONLY`) before running the statement, so the engine itself rejects any write — INSERT/
 * UPDATE/DDL and side-effecting functions in read position (e.g. `nextval()`) alike. The
 * dashboard data viewer uses this so a classifier blind spot can't mutate even over the owner
 * connection. (`max: 1` guarantees the SET and the query share one connection.)
 *
 * The result is capped to {@link RunSqlOptions.maxRows}/{@link RunSqlOptions.maxBytes} rows
 * (truncating + flagging `truncated`) so a `SELECT *` on a huge table can't balloon the API
 * server's memory or the response. That bounds what we buffer-and-send *after* the fact; the
 * DB-side work that produces the rows is bounded by the statement timeout — set at the role
 * level for the agent scope roles, or per-session here via {@link RunSqlOptions.statementTimeoutMs}
 * (the dashboard viewer's owner connection has no role-level timeout, so it must pass one).
 */
export interface RunSqlOptions {
  readOnly?: boolean
  /** Max rows to return; beyond this the result is truncated and `truncated` set. Defaults to
   * {@link QUERY_LIMITS.maxResultRows}. */
  maxRows?: number
  /** Max serialized result size in bytes; the largest row prefix that fits is kept. Defaults to
   * {@link QUERY_LIMITS.maxResultBytes}. */
  maxBytes?: number
  /** Per-session `statement_timeout` (ms) to apply before running. Omit to inherit whatever the
   * connection's role already enforces (the agent scope roles set their own). */
  statementTimeoutMs?: number
}

/** Cap a buffered result set to the row and byte ceilings, flagging when rows were dropped. */
function capRows(
  allRows: Record<string, unknown>[],
  options: RunSqlOptions,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  const maxRows = options.maxRows ?? QUERY_LIMITS.maxResultRows
  const maxBytes = options.maxBytes ?? QUERY_LIMITS.maxResultBytes
  let truncated = allRows.length > maxRows
  let rows = truncated ? allRows.slice(0, maxRows) : allRows
  // Byte ceiling: a handful of wide rows (large JSON/bytea) can blow the budget while staying
  // under the row count, so keep the largest row prefix whose serialized size fits.
  let total = 0
  let keep = rows.length
  for (const [i, row] of rows.entries()) {
    total += byteLength(JSON.stringify(row)) + 1
    if (total > maxBytes) {
      keep = i
      break
    }
  }
  if (keep < rows.length) {
    rows = rows.slice(0, keep)
    truncated = true
  }
  return { rows, truncated }
}

export async function runSql(
  connectionUri: string,
  sql: string,
  params: unknown[] = [],
  options: RunSqlOptions = {},
): Promise<QueryResult> {
  const client = postgres(connectionUri, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 15,
  })
  try {
    // Session prelude — read-only mode and/or a statement timeout — in one round-trip before the
    // statement. (`max: 1` guarantees these and the query share the one connection.)
    const prelude: string[] = []
    if (options.readOnly === true) {
      prelude.push('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    }
    if (options.statementTimeoutMs !== undefined) {
      prelude.push(`SET statement_timeout = ${Math.floor(options.statementTimeoutMs)}`)
    }
    if (prelude.length > 0) {
      await client.unsafe(prelude.join('; '))
    }
    const result = params.length > 0 ? await client.unsafe(sql, params as never[]) : await client.unsafe(sql)
    const allRows = [...(result as unknown as Record<string, unknown>[])]
    const meta = result as unknown as PgResultMeta
    const { rows, truncated } = capRows(allRows, options)
    return {
      rows,
      rowCount: typeof meta.count === 'number' ? meta.count : allRows.length,
      command: meta.command ?? null,
      fields: (meta.columns ?? []).map((c) => c.name),
      truncated,
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
