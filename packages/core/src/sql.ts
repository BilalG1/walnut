import type { DbScope } from './scopes.ts'

/**
 * Maps a leading SQL keyword to the scope its operation requires. Scopes are
 * independent capabilities (an agent can hold `db:delete` without `db:ddl`), so
 * a statement is classified by the *operations it performs*, not a privilege
 * ladder. A statement (or batch) may require several scopes at once.
 */
const KEYWORD_SCOPE: Record<string, DbScope> = {
  // read / utility (baseline access)
  SELECT: 'db:read',
  TABLE: 'db:read',
  VALUES: 'db:read',
  SHOW: 'db:read',
  EXPLAIN: 'db:read',
  FETCH: 'db:read',
  SET: 'db:read',
  RESET: 'db:read',
  BEGIN: 'db:read',
  START: 'db:read',
  COMMIT: 'db:read',
  END: 'db:read',
  ROLLBACK: 'db:read',
  SAVEPOINT: 'db:read',
  RELEASE: 'db:read',
  // write
  INSERT: 'db:write',
  UPDATE: 'db:write',
  MERGE: 'db:write',
  COPY: 'db:write',
  UPSERT: 'db:write',
  // delete
  DELETE: 'db:delete',
  TRUNCATE: 'db:delete',
  // ddl / privileged
  CREATE: 'db:ddl',
  ALTER: 'db:ddl',
  DROP: 'db:ddl',
  RENAME: 'db:ddl',
  GRANT: 'db:ddl',
  REVOKE: 'db:ddl',
  COMMENT: 'db:ddl',
  VACUUM: 'db:ddl',
  ANALYZE: 'db:ddl',
  REINDEX: 'db:ddl',
  CLUSTER: 'db:ddl',
  REFRESH: 'db:ddl',
  LOCK: 'db:ddl',
}

export interface SqlClassification {
  /** True when the input is empty / only comments. */
  empty: boolean
  /** First meaningful SQL keyword of the batch, upper-cased, or null when empty. */
  firstKeyword: string | null
  /** Number of non-empty statements in the batch. */
  statementCount: number
  /** Every scope the batch needs, deduplicated, in no particular order. */
  requiredScopes: DbScope[]
}

/** Remove comments and neutralise string/identifier literals so a token scan
 * doesn't trip over a column named `delete`, the text `'DROP'` in a value, or a
 * stray `;` inside a dollar-quoted function body. */
function stripSqlNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
}

function classifyStatementInto(tokens: readonly string[], scopes: Set<DbScope>): void {
  const first = tokens[0]
  if (first === undefined) {
    return
  }

  // A WITH (CTE) query can wrap a data-modifying statement, so scan the whole
  // statement and add every non-read scope its keywords imply.
  if (first === 'WITH') {
    scopes.add('db:read')
    for (const token of tokens) {
      const scope = KEYWORD_SCOPE[token]
      if (scope !== undefined && scope !== 'db:read') {
        scopes.add(scope)
      }
    }
    return
  }

  const firstScope = KEYWORD_SCOPE[first]
  if (firstScope !== undefined) {
    scopes.add(firstScope)
  } else {
    // Unknown leading keyword — fail safe to the most privileged scope so an
    // unrecognised command can never slip through under a weaker grant.
    scopes.add('db:ddl')
  }
}

/**
 * Classify a SQL string (one or many `;`-separated statements) into the scope(s)
 * it requires. Every statement is inspected and the results unioned, so a batch
 * like `SELECT 1; DROP TABLE x` correctly requires both `db:read` and `db:ddl`
 * and cannot be smuggled past a read-only grant.
 */
export function classifySql(raw: string): SqlClassification {
  const cleaned = stripSqlNoise(raw)
  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (statements.length === 0) {
    return { empty: true, firstKeyword: null, statementCount: 0, requiredScopes: [] }
  }

  const scopes = new Set<DbScope>()
  let firstKeyword: string | null = null

  for (const statement of statements) {
    const tokens = statement.toUpperCase().match(/[A-Z]+/g) ?? []
    if (tokens.length === 0) {
      continue
    }
    firstKeyword ??= tokens[0] ?? null
    classifyStatementInto(tokens, scopes)
  }

  if (scopes.size === 0) {
    scopes.add('db:ddl')
  }

  return {
    empty: false,
    firstKeyword,
    statementCount: statements.length,
    requiredScopes: [...scopes],
  }
}
