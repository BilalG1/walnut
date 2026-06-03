/**
 * The execution seam. The Postgres adapter never opens a connection itself — the host injects
 * a `SqlRunner` that actually runs a parameterized statement. In `@walnut/web` it posts to the
 * dashboard `/sql` route (which classifier-gates to `db:read` and runs over the project
 * connection); server-side or in tests it can wrap `runSql` directly. Keeping execution out of
 * the package is what lets the viewer stay decoupled from any particular transport or driver.
 */
export interface RawResult {
  /** Result rows as plain objects keyed by output column name. */
  rows: Record<string, unknown>[]
  /** Column names in result order. */
  fields: string[]
}

export interface SqlRunner {
  (sql: string, params: unknown[], opts?: { signal?: AbortSignal }): Promise<RawResult>
}
