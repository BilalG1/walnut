import { describe, expect, test } from 'bun:test'
import { classifySql } from '../src/sql.ts'
import type { DbScope } from '../src/scopes.ts'

function scopes(sql: string): DbScope[] {
  return classifySql(sql).requiredScopes.toSorted()
}

describe('classifySql', () => {
  test('classifies basic reads', () => {
    expect(scopes('SELECT * FROM users')).toEqual(['db:read'])
    expect(scopes('select 1')).toEqual(['db:read'])
    expect(scopes('EXPLAIN SELECT * FROM t')).toEqual(['db:read'])
    expect(scopes('SHOW search_path')).toEqual(['db:read'])
    expect(scopes('SET statement_timeout = 0')).toEqual(['db:read'])
  })

  test('classifies writes', () => {
    expect(scopes("INSERT INTO t (a) VALUES (1)")).toEqual(['db:write'])
    expect(scopes('UPDATE t SET a = 1')).toEqual(['db:write'])
    expect(scopes('INSERT INTO t SELECT * FROM s')).toEqual(['db:write'])
  })

  test('classifies deletes', () => {
    expect(scopes('DELETE FROM t WHERE id = 1')).toEqual(['db:delete'])
    expect(scopes('TRUNCATE t')).toEqual(['db:delete'])
  })

  test('classifies DDL', () => {
    expect(scopes('CREATE TABLE t (id int)')).toEqual(['db:ddl'])
    expect(scopes('ALTER TABLE t ADD COLUMN b text')).toEqual(['db:ddl'])
    expect(scopes('DROP TABLE t')).toEqual(['db:ddl'])
  })

  test('reports empty for blank or comment-only input', () => {
    expect(classifySql('').empty).toBe(true)
    expect(classifySql('   ').empty).toBe(true)
    expect(classifySql('-- just a comment').empty).toBe(true)
    expect(classifySql('/* block */').empty).toBe(true)
  })

  test('unions scopes across a multi-statement batch (injection guard)', () => {
    expect(scopes('SELECT 1; DROP TABLE x')).toEqual(['db:ddl', 'db:read'])
    expect(scopes('INSERT INTO t VALUES (1); DELETE FROM t')).toEqual(['db:delete', 'db:write'])
  })

  test('does not trip on keywords inside string literals', () => {
    expect(scopes("SELECT 'DROP TABLE everything' AS note")).toEqual(['db:read'])
    expect(scopes("SELECT * FROM t WHERE name = 'DELETE'")).toEqual(['db:read'])
  })

  test('does not trip on quoted identifiers', () => {
    expect(scopes('SELECT "delete", "update" FROM t')).toEqual(['db:read'])
  })

  test('detects data-modifying CTEs', () => {
    expect(scopes('WITH cte AS (SELECT 1) SELECT * FROM cte')).toEqual(['db:read'])
    expect(scopes('WITH moved AS (DELETE FROM a RETURNING *) INSERT INTO b SELECT * FROM moved')).toEqual([
      'db:delete',
      'db:read',
      'db:write',
    ])
  })

  test('EXPLAIN ANALYZE requires the analyzed statement’s scopes (it executes)', () => {
    // Plain EXPLAIN only plans -> read.
    expect(scopes('EXPLAIN SELECT * FROM t')).toEqual(['db:read'])
    expect(scopes('EXPLAIN DELETE FROM t')).toEqual(['db:read'])
    // EXPLAIN ANALYZE actually runs the statement -> needs its scope.
    expect(scopes('EXPLAIN ANALYZE SELECT 1')).toEqual(['db:read'])
    expect(scopes('EXPLAIN ANALYZE DELETE FROM accounts')).toEqual(['db:delete', 'db:read'])
    expect(scopes('EXPLAIN ANALYZE UPDATE accounts SET balance = 0')).toEqual(['db:read', 'db:write'])
    expect(scopes('EXPLAIN (ANALYZE, BUFFERS) INSERT INTO logs VALUES (1)')).toEqual(['db:read', 'db:write'])
    expect(scopes('EXPLAIN ANALYZE CREATE TABLE x AS SELECT 1')).toEqual(['db:ddl', 'db:read'])
    expect(scopes('EXPLAIN ANALYZE WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d')).toEqual([
      'db:delete',
      'db:read',
    ])
  })

  test('SET ROLE / SESSION AUTHORIZATION require db:ddl; other SETs are read', () => {
    expect(scopes('SET search_path = public')).toEqual(['db:read'])
    expect(scopes('SET ROLE postgres')).toEqual(['db:ddl'])
    expect(scopes('SET SESSION AUTHORIZATION someone')).toEqual(['db:ddl'])
    expect(scopes('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')).toEqual(['db:read'])
  })

  test('COPY ... FROM/TO PROGRAM requires db:ddl (host command execution)', () => {
    expect(scopes('COPY t FROM STDIN')).toEqual(['db:write'])
    expect(scopes("COPY t FROM PROGRAM 'rm -rf /'")).toEqual(['db:ddl', 'db:write'])
    expect(scopes("COPY t TO PROGRAM 'cat > /tmp/x'")).toEqual(['db:ddl', 'db:write'])
  })

  test('fails safe to db:ddl for unrecognised commands', () => {
    expect(scopes('DO $$ BEGIN PERFORM 1; END $$')).toEqual(['db:ddl'])
    expect(scopes('LOCK TABLE t')).toEqual(['db:ddl'])
  })

  test('strips comments before classifying', () => {
    expect(scopes('-- delete everything\nSELECT 1')).toEqual(['db:read'])
    expect(scopes('SELECT 1 /* DROP TABLE x */')).toEqual(['db:read'])
  })

  test('reports statement count and first keyword', () => {
    const c = classifySql('SELECT 1; SELECT 2')
    expect(c.statementCount).toBe(2)
    expect(c.firstKeyword).toBe('SELECT')
  })
})
