import { describe, expect, test } from 'bun:test'
import { classifySql } from '../src/sql.ts'
import type { DbScope } from '../src/scopes.ts'

async function scopes(sql: string): Promise<DbScope[]> {
  return (await classifySql(sql)).requiredScopes.toSorted()
}

describe('classifySql', () => {
  test('classifies basic reads', async () => {
    expect(await scopes('SELECT * FROM users')).toEqual(['db:read'])
    expect(await scopes('select 1')).toEqual(['db:read'])
    expect(await scopes('EXPLAIN SELECT * FROM t')).toEqual(['db:read'])
    expect(await scopes('SHOW search_path')).toEqual(['db:read'])
    expect(await scopes('SET statement_timeout = 0')).toEqual(['db:read'])
    expect(await scopes('TABLE users')).toEqual(['db:read'])
    expect(await scopes('VALUES (1), (2)')).toEqual(['db:read'])
  })

  test('classifies writes', async () => {
    expect(await scopes('INSERT INTO t (a) VALUES (1)')).toEqual(['db:write'])
    expect(await scopes('UPDATE t SET a = 1')).toEqual(['db:write'])
    // The SELECT feeding an INSERT does not add db:read — write covers it.
    expect(await scopes('INSERT INTO t SELECT * FROM s')).toEqual(['db:write'])
  })

  test('classifies deletes', async () => {
    expect(await scopes('DELETE FROM t WHERE id = 1')).toEqual(['db:delete'])
    expect(await scopes('TRUNCATE t')).toEqual(['db:delete'])
  })

  test('classifies DDL', async () => {
    expect(await scopes('CREATE TABLE t (id int)')).toEqual(['db:ddl'])
    expect(await scopes('ALTER TABLE t ADD COLUMN b text')).toEqual(['db:ddl'])
    expect(await scopes('DROP TABLE t')).toEqual(['db:ddl'])
    expect(await scopes('CREATE TABLE x AS SELECT 1')).toEqual(['db:ddl'])
  })

  test('SELECT ... INTO is DDL, not read (it creates a table)', async () => {
    // A leading-keyword scan classifies this as read; the real grammar sees the CTAS.
    expect(await scopes('SELECT 1 AS n INTO new_table')).toEqual(['db:ddl'])
    expect(await scopes('SELECT * INTO new_table FROM t')).toEqual(['db:ddl'])
  })

  test('reports empty for blank or comment-only input', async () => {
    expect((await classifySql('')).empty).toBe(true)
    expect((await classifySql('   ')).empty).toBe(true)
    expect((await classifySql('-- just a comment')).empty).toBe(true)
    expect((await classifySql('/* block */')).empty).toBe(true)
  })

  test('unions scopes across a multi-statement batch (injection guard)', async () => {
    expect(await scopes('SELECT 1; DROP TABLE x')).toEqual(['db:ddl', 'db:read'])
    expect(await scopes('INSERT INTO t VALUES (1); DELETE FROM t')).toEqual(['db:delete', 'db:write'])
  })

  test('does not trip on keywords inside string literals', async () => {
    expect(await scopes("SELECT 'DROP TABLE everything' AS note")).toEqual(['db:read'])
    expect(await scopes("SELECT * FROM t WHERE name = 'DELETE'")).toEqual(['db:read'])
  })

  test('does not trip on quoted identifiers', async () => {
    expect(await scopes('SELECT "delete", "update" FROM t')).toEqual(['db:read'])
  })

  test('does not trip on dollar-quoted string bodies', async () => {
    expect(await scopes("SELECT $$DROP TABLE x; DELETE FROM y$$ AS note")).toEqual(['db:read'])
  })

  test('detects data-modifying CTEs', async () => {
    expect(await scopes('WITH cte AS (SELECT 1) SELECT * FROM cte')).toEqual(['db:read'])
    expect(
      await scopes('WITH moved AS (DELETE FROM a RETURNING *) INSERT INTO b SELECT * FROM moved'),
    ).toEqual(['db:delete', 'db:read', 'db:write'])
  })

  test('MERGE requires write, plus delete when a clause deletes', async () => {
    expect(await scopes('MERGE INTO t USING s ON t.id = s.id WHEN NOT MATCHED THEN INSERT VALUES (1)')).toEqual([
      'db:write',
    ])
    expect(await scopes('MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE')).toEqual([
      'db:delete',
      'db:write',
    ])
  })

  test('EXPLAIN ANALYZE requires the analyzed statement’s scopes (it executes)', async () => {
    // Plain EXPLAIN only plans -> read.
    expect(await scopes('EXPLAIN SELECT * FROM t')).toEqual(['db:read'])
    expect(await scopes('EXPLAIN DELETE FROM t')).toEqual(['db:read'])
    // EXPLAIN ANALYZE actually runs the statement -> needs its scope.
    expect(await scopes('EXPLAIN ANALYZE SELECT 1')).toEqual(['db:read'])
    expect(await scopes('EXPLAIN ANALYZE DELETE FROM accounts')).toEqual(['db:delete', 'db:read'])
    expect(await scopes('EXPLAIN ANALYZE UPDATE accounts SET balance = 0')).toEqual(['db:read', 'db:write'])
    expect(await scopes('EXPLAIN (ANALYZE, BUFFERS) INSERT INTO logs VALUES (1)')).toEqual([
      'db:read',
      'db:write',
    ])
    expect(await scopes('EXPLAIN ANALYZE CREATE TABLE x AS SELECT 1')).toEqual(['db:ddl', 'db:read'])
    expect(await scopes('EXPLAIN ANALYZE WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d')).toEqual([
      'db:delete',
      'db:read',
    ])
  })

  test('SET ROLE / SESSION AUTHORIZATION require db:ddl; other SETs are read', async () => {
    expect(await scopes('SET search_path = public')).toEqual(['db:read'])
    expect(await scopes('SET ROLE postgres')).toEqual(['db:ddl'])
    expect(await scopes('SET SESSION AUTHORIZATION someone')).toEqual(['db:ddl'])
    expect(await scopes('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')).toEqual(['db:read'])
    // RESET / DEFAULT forms of role switching are privileged too.
    expect(await scopes('RESET ROLE')).toEqual(['db:ddl'])
    expect(await scopes('SET SESSION AUTHORIZATION DEFAULT')).toEqual(['db:ddl'])
    expect(await scopes('RESET ALL')).toEqual(['db:read'])
  })

  test('COPY ... FROM/TO PROGRAM requires db:ddl (host command execution)', async () => {
    expect(await scopes('COPY t FROM STDIN')).toEqual(['db:write'])
    expect(await scopes("COPY t FROM PROGRAM 'rm -rf /'")).toEqual(['db:ddl', 'db:write'])
    expect(await scopes("COPY t TO PROGRAM 'cat > /tmp/x'")).toEqual(['db:ddl', 'db:write'])
  })

  test('fails safe to db:ddl for unrecognised commands', async () => {
    expect(await scopes('DO $$ BEGIN PERFORM 1; END $$')).toEqual(['db:ddl'])
    expect(await scopes('LOCK TABLE t')).toEqual(['db:ddl'])
    expect(await scopes('CALL do_something()')).toEqual(['db:ddl'])
  })

  test('fails safe to db:ddl on a syntax error', async () => {
    expect(await scopes('SELZECT 1')).toEqual(['db:ddl'])
    expect((await classifySql('SELZECT 1')).empty).toBe(false)
  })

  test('ignores comments around real statements', async () => {
    expect(await scopes('-- delete everything\nSELECT 1')).toEqual(['db:read'])
    expect(await scopes('SELECT 1 /* DROP TABLE x */')).toEqual(['db:read'])
  })

  test('reports statement count and first keyword', async () => {
    const c = await classifySql('SELECT 1; SELECT 2')
    expect(c.statementCount).toBe(2)
    expect(c.firstKeyword).toBe('SELECT')
  })
})
