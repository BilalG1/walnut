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
