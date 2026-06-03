/**
 * Identifier quoting. Values are always parameterized (`$1`, `$2`, …) so they never pass
 * through here — but identifiers (table and column names) cannot be parameters in SQL, so
 * they must be quoted. We double-quote and escape embedded quotes by doubling them, which
 * neutralizes reserved words, mixed case, and injection attempts alike. Callers additionally
 * validate every identifier against the table's introspected columns before it reaches SQL.
 */

/** Quote a single SQL identifier (column or relation name). */
export function quoteIdent(name: string): string {
  // A NUL byte can't appear in a real Postgres identifier; reject defensively rather than
  // emit something the server will choke on in a confusing way.
  if (name.includes('\u0000')) {
    throw new Error('identifier contains a null byte')
  }
  return `"${name.replace(/"/g, '""')}"`
}

/** Quote a schema-qualified relation: `"schema"."name"`. */
export function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}
