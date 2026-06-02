import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PORT_PREFIX,
  localPostgresUrl,
  localServiceUrl,
  normalizePortPrefix,
  portFor,
} from '../src/ports.ts'

describe('ports', () => {
  test('default prefix reproduces the historical 3000/3001/3002 layout', () => {
    expect(DEFAULT_PORT_PREFIX).toBe('30')
    expect(portFor('web')).toBe(3000)
    expect(portFor('api')).toBe(3001)
    expect(portFor('postgres')).toBe(3002)
  })

  test('a custom prefix moves every port together', () => {
    expect(portFor('web', '41')).toBe(4100)
    expect(portFor('api', '41')).toBe(4101)
    expect(portFor('postgres', '41')).toBe(4102)
  })

  test('normalizePortPrefix falls back to the default when unset/empty', () => {
    expect(normalizePortPrefix(undefined)).toBe('30')
    expect(normalizePortPrefix('')).toBe('30')
    expect(normalizePortPrefix('  ')).toBe('30')
    expect(normalizePortPrefix(' 41 ')).toBe('41')
  })

  test('normalizePortPrefix rejects non-two-digit prefixes', () => {
    expect(() => normalizePortPrefix('4')).toThrow(/two digits/)
    expect(() => normalizePortPrefix('410')).toThrow(/two digits/)
    expect(() => normalizePortPrefix('4a')).toThrow(/two digits/)
  })

  test('normalizePortPrefix rejects prefixes that fall in the privileged range', () => {
    expect(() => normalizePortPrefix('10')).toThrow(/privileged/)
    expect(normalizePortPrefix('11')).toBe('11')
  })

  test('localPostgresUrl embeds the derived port and the given database', () => {
    expect(localPostgresUrl({ database: 'walnut' })).toBe('postgres://walnut:walnut@localhost:3002/walnut')
    expect(localPostgresUrl({ database: 'postgres', prefix: '41' })).toBe(
      'postgres://walnut:walnut@localhost:4102/postgres',
    )
  })

  test('localServiceUrl builds an http URL on the derived port', () => {
    expect(localServiceUrl('api')).toBe('http://localhost:3001')
    expect(localServiceUrl('web', '41')).toBe('http://localhost:4100')
  })
})
