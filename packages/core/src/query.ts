import postgres from 'postgres'

export interface QueryResult {
  /** Result rows as plain objects (empty for non-returning statements). */
  rows: Record<string, unknown>[]
  /** Rows returned or affected, as reported by Postgres. */
  rowCount: number
  /** The command tag, e.g. `SELECT`, `INSERT`, `CREATE TABLE`. */
  command: string | null
  /** Column names in result order. */
  fields: string[]
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
 */
export interface RunSqlOptions {
  readOnly?: boolean
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
    if (options.readOnly === true) {
      await client.unsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    }
    const result = params.length > 0 ? await client.unsafe(sql, params as never[]) : await client.unsafe(sql)
    const rows = [...(result as unknown as Record<string, unknown>[])]
    const meta = result as unknown as PgResultMeta
    return {
      rows,
      rowCount: typeof meta.count === 'number' ? meta.count : rows.length,
      command: meta.command ?? null,
      fields: (meta.columns ?? []).map((c) => c.name),
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
