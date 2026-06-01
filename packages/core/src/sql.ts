import { parse } from 'pgsql-parser'
import type { DbScope } from './scopes.ts'

/**
 * Maps a statement to the scope(s) it requires, using the *real* PostgreSQL
 * grammar (libpg_query via pgsql-parser) rather than a token scan. Working from
 * an AST means comments, string/dollar-quoted literals, quoted identifiers and
 * nested statements are handled by the parser, not by hand.
 *
 * Since per-agent Postgres roles now enforce scopes at the database engine
 * (see roles.ts), this classifier is the *first* guard and the UX layer that
 * powers the scope-request approval loop — not the sole boundary. It still fails
 * safe (unknown/unmapped statement → db:ddl) so it never under-reports.
 */

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

/** Minimal view of the parse tree we depend on (the full AST is a large union). */
interface RawStmt {
  stmt?: unknown
}
interface ParseTree {
  stmts?: RawStmt[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Statement *node types* are PascalCase + `Stmt` (e.g. `SelectStmt`); plain fields like
 * `selectStmt` are camelCase and must not be mistaken for nested statements. */
function isStmtNodeType(key: string): boolean {
  return /^[A-Z]\w*Stmt$/.test(key)
}

/** Unwrap a node like `{ SelectStmt: {...} }` into its type tag and body. */
function unwrap(node: unknown): { type: string; body: Record<string, unknown> } | null {
  if (!isRecord(node)) {
    return null
  }
  const type = Object.keys(node)[0]
  if (type === undefined) {
    return null
  }
  const body = node[type]
  return { type, body: isRecord(body) ? body : {} }
}

/** Statement nodes that need only read access (beyond SELECT and SET, handled inline). */
const READ_NODES: ReadonlySet<string> = new Set([
  'VariableShowStmt', // SHOW
  'TransactionStmt', // BEGIN / COMMIT / ROLLBACK / SAVEPOINT / RELEASE
  'DeclareCursorStmt', // DECLARE ... CURSOR
  'FetchStmt', // FETCH / MOVE
  'ClosePortalStmt', // CLOSE
])

/** True for `EXPLAIN ANALYZE`, which actually *executes* the analyzed statement. */
function explainExecutes(body: Record<string, unknown>): boolean {
  const options = body.options
  if (!Array.isArray(options)) {
    return false
  }
  return options.some((opt) => unwrap(opt)?.body.defname === 'analyze')
}

/** True for any statement that changes the effective role — `SET ROLE ...`,
 * `SET SESSION AUTHORIZATION ...`, and their `RESET` / `DEFAULT` forms. */
function setsRole(body: Record<string, unknown>): boolean {
  if (body.name !== 'role' && body.name !== 'session_authorization') {
    return false
  }
  return body.kind === 'VAR_SET_VALUE' || body.kind === 'VAR_SET_DEFAULT' || body.kind === 'VAR_RESET'
}

/** Add the scope(s) implied by `MERGE`, whose WHEN clauses may insert, update or delete. */
function addMergeScopes(body: Record<string, unknown>, scopes: Set<DbScope>): void {
  scopes.add('db:write')
  const clauses = body.mergeWhenClauses
  if (Array.isArray(clauses)) {
    for (const clause of clauses) {
      if (unwrap(clause)?.body.commandType === 'CMD_DELETE') {
        scopes.add('db:delete')
      }
    }
  }
}

/** The base scope of a statement, by its node type. Unknown/DDL → db:ddl (fail safe). */
function addBaseScope(type: string, body: Record<string, unknown>, scopes: Set<DbScope>): void {
  switch (type) {
    case 'SelectStmt':
      // `SELECT ... INTO new_table` is really CREATE TABLE AS — a token scan misses this.
      scopes.add(body.intoClause === undefined ? 'db:read' : 'db:ddl')
      return
    case 'InsertStmt':
    case 'UpdateStmt':
      scopes.add('db:write')
      return
    case 'DeleteStmt':
    case 'TruncateStmt':
      scopes.add('db:delete')
      return
    case 'MergeStmt':
      addMergeScopes(body, scopes)
      return
    case 'CopyStmt':
      scopes.add('db:write')
      if (body.is_program === true) {
        scopes.add('db:ddl') // COPY ... FROM/TO PROGRAM runs a shell command on the host.
      }
      return
    case 'VariableSetStmt':
      scopes.add(setsRole(body) ? 'db:ddl' : 'db:read')
      return
    default:
      scopes.add(READ_NODES.has(type) ? 'db:read' : 'db:ddl')
  }
}

/** Add only the *modifying* scope of a nested statement (read contributes nothing, so a
 * SELECT feeding an INSERT doesn't add db:read; a writable CTE's DELETE does add db:delete). */
function addNestedModifyingScope(type: string, body: Record<string, unknown>, scopes: Set<DbScope>): void {
  switch (type) {
    case 'InsertStmt':
    case 'UpdateStmt':
      scopes.add('db:write')
      return
    case 'DeleteStmt':
    case 'TruncateStmt':
      scopes.add('db:delete')
      return
    case 'MergeStmt':
      addMergeScopes(body, scopes)
      return
    case 'CopyStmt':
      scopes.add('db:write')
      if (body.is_program === true) {
        scopes.add('db:ddl')
      }
      return
    case 'SelectStmt':
      if (body.intoClause !== undefined) {
        scopes.add('db:ddl')
      }
      return
    case 'VariableSetStmt':
    case 'ExplainStmt':
      return // read-level / never nested in a way that adds privilege
    default:
      if (!READ_NODES.has(type)) {
        scopes.add('db:ddl') // unknown/DDL nested (e.g. a CTE we don't recognise) → fail safe
      }
  }
}

/** Deep-walk a statement body, adding the modifying scope of every nested statement node
 * (writable CTEs, sub-statements). Read-only subqueries contribute nothing. */
function collectNestedModifying(value: unknown, scopes: Set<DbScope>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedModifying(item, scopes)
    }
    return
  }
  if (!isRecord(value)) {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (isStmtNodeType(key) && isRecord(child)) {
      addNestedModifyingScope(key, child, scopes)
    }
    collectNestedModifying(child, scopes)
  }
}

/** Classify one top-level (or EXPLAIN-inner) statement into the scopes it requires. */
function classifyStatement(node: unknown, scopes: Set<DbScope>): void {
  const unwrapped = unwrap(node)
  if (unwrapped === null) {
    return
  }
  const { type, body } = unwrapped

  // EXPLAIN only plans (read); EXPLAIN ANALYZE executes the analyzed statement, so it
  // needs that statement's scopes. Handle it explicitly so we never recurse into a
  // non-executing plan.
  if (type === 'ExplainStmt') {
    scopes.add('db:read')
    if (explainExecutes(body)) {
      classifyStatement(body.query, scopes)
    }
    return
  }

  addBaseScope(type, body, scopes)
  // A CTE-bearing statement reads its CTE results, so it needs at least read (this also
  // makes `WITH x AS (DELETE ...) INSERT ...` require read+write+delete together).
  if (body.withClause !== undefined && body.withClause !== null) {
    scopes.add('db:read')
  }
  collectNestedModifying(body, scopes)
}

/** First SQL keyword of the input (after leading whitespace/comments), upper-cased. */
function firstKeyword(raw: string): string | null {
  const stripped = raw.replace(/^(?:\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, '')
  const match = /^[A-Za-z]+/.exec(stripped)
  return match === null ? null : match[0].toUpperCase()
}

const EMPTY: SqlClassification = { empty: true, firstKeyword: null, statementCount: 0, requiredScopes: [] }

/**
 * Classify a SQL string (one or many `;`-separated statements) into the scope(s) it
 * requires. Every statement is inspected and the results unioned, so a batch like
 * `SELECT 1; DROP TABLE x` correctly requires both `db:read` and `db:ddl` and cannot be
 * smuggled past a read-only grant.
 */
export async function classifySql(raw: string): Promise<SqlClassification> {
  let tree: ParseTree
  try {
    tree = (await parse(raw)) as unknown as ParseTree
  } catch {
    // Empty / whitespace-only input parses as "empty"; anything else is a syntax error,
    // which we fail safe to the most privileged scope (the engine is the real boundary).
    if (raw.trim() === '') {
      return EMPTY
    }
    return { empty: false, firstKeyword: firstKeyword(raw), statementCount: 1, requiredScopes: ['db:ddl'] }
  }

  const statements = (tree.stmts ?? []).filter((s): s is { stmt: unknown } => s.stmt !== undefined)
  if (statements.length === 0) {
    return EMPTY
  }

  const scopes = new Set<DbScope>()
  for (const { stmt } of statements) {
    classifyStatement(stmt, scopes)
  }
  if (scopes.size === 0) {
    scopes.add('db:ddl')
  }

  return {
    empty: false,
    firstKeyword: firstKeyword(raw),
    statementCount: statements.length,
    requiredScopes: [...scopes],
  }
}
