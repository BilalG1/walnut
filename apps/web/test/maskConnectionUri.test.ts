import { describe, expect, test } from 'bun:test'
import { maskConnectionUri } from '../src/lib/format.ts'

describe('maskConnectionUri', () => {
  test('hides the password', () => {
    expect(maskConnectionUri('postgres://user:secret@host:5432/db')).toBe('postgres://user:••••••@host:5432/db')
  })

  test('leaves a password-less URI unchanged', () => {
    expect(maskConnectionUri('postgres://host:5432/db')).toBe('postgres://host:5432/db')
  })

  test('does not mask an @ in the query string', () => {
    expect(maskConnectionUri('postgres://u:p@host/db?options=a@b')).toBe('postgres://u:••••••@host/db?options=a@b')
  })
})
