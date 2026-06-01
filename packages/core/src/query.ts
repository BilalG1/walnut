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
 */
export async function runSql(connectionUri: string, sql: string): Promise<QueryResult> {
  const client = postgres(connectionUri, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 15,
  })
  try {
    const result = await client.unsafe(sql)
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
