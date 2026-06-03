import type { ColumnMeta, ColumnReference, TableKind, TableRef } from '../types.ts'
import type { SqlRunner } from './runner.ts'
import { kindFromUdt } from './typemap.ts'

/**
 * Schema introspection. These are ordinary `SELECT`s against `information_schema` / `pg_catalog`,
 * so they classify as `db:read` and flow through the same gated runner as data queries.
 */

const LIST_TABLES_SQL = `
SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind, c.reltuples::float8 AS est
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p') AND n.nspname = ANY($1)
ORDER BY n.nspname, c.relname
`

export async function listTables(
  run: SqlRunner,
  schemas: string[],
  opts?: { signal?: AbortSignal },
): Promise<TableRef[]> {
  const result = await run(LIST_TABLES_SQL, [schemas], opts)
  return result.rows.map((row) => ({
    schema: String(row.schema),
    name: String(row.name),
    kind: relkindToKind(String(row.relkind)),
    estimatedRows: estimateRows(row.est),
  }))
}

function relkindToKind(relkind: string): TableKind {
  switch (relkind) {
    case 'v':
      return 'view'
    case 'm':
      return 'materialized_view'
    case 'f':
      return 'foreign'
    default:
      // 'r' (table) and 'p' (partitioned table) both present as a plain table.
      return 'table'
  }
}

/** Postgres reports `reltuples = -1` for a never-analyzed relation; surface that as unknown. */
function estimateRows(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return null
  }
  return Math.round(n)
}

const COLUMNS_SQL = `
SELECT column_name AS name, data_type, udt_name, is_nullable, column_default, ordinal_position
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
ORDER BY ordinal_position
`

const PK_SQL = `
SELECT a.attname AS name
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE i.indisprimary AND n.nspname = $1 AND c.relname = $2
`

// Pair each local FK column with its referenced column by ordinal position. The
// information_schema join (table_constraints → key_column_usage → constraint_column_usage on
// constraint_name alone) produces a cross-product for multi-column FKs and mislabels them;
// unnesting conkey/confkey together keeps the pairing correct.
const FK_SQL = `
SELECT att.attname AS name,
       fn.nspname AS ref_schema,
       fc.relname AS ref_table,
       fatt.attname AS ref_column
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_class fc ON fc.oid = con.confrelid
JOIN pg_namespace fn ON fn.oid = fc.relnamespace
JOIN LATERAL unnest(con.conkey, con.confkey) AS k(attnum, fattnum) ON true
JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = k.fattnum
WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2
`

export async function getColumns(
  run: SqlRunner,
  table: TableRef,
  opts?: { signal?: AbortSignal },
): Promise<ColumnMeta[]> {
  const params = [table.schema, table.name]
  const [cols, pks, fks] = await Promise.all([
    run(COLUMNS_SQL, params, opts),
    run(PK_SQL, params, opts),
    run(FK_SQL, params, opts),
  ])

  const pkSet = new Set(pks.rows.map((r) => String(r.name)))
  const fkMap = new Map<string, ColumnReference>()
  for (const r of fks.rows) {
    fkMap.set(String(r.name), {
      schema: String(r.ref_schema),
      table: String(r.ref_table),
      column: String(r.ref_column),
    })
  }

  return cols.rows.map((row) => {
    const name = String(row.name)
    return {
      name,
      kind: kindFromUdt(String(row.data_type), String(row.udt_name)),
      udtName: String(row.udt_name),
      nullable: row.is_nullable === 'YES',
      isPrimaryKey: pkSet.has(name),
      default: row.column_default == null ? null : String(row.column_default),
      references: fkMap.get(name) ?? null,
    }
  })
}
