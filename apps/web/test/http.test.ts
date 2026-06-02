import { describe, expect, test } from 'bun:test'
import { ApiError, unwrap } from '../src/data/http.ts'

describe('unwrap', () => {
  test('returns data on success', async () => {
    const value = await unwrap(Promise.resolve({ data: { hello: 'world' }, error: null, status: 200 }))
    expect(value).toEqual({ hello: 'world' })
  })

  test('throws an ApiError carrying the server message and status', async () => {
    let caught: unknown
    try {
      await unwrap(Promise.resolve({ data: null, error: { status: 403, value: { message: 'nope' } }, status: 403 }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(403)
    expect((caught as ApiError).message).toBe('nope')
  })

  test('falls back to a generic message when the error body has none', async () => {
    let caught: unknown
    try {
      await unwrap(Promise.resolve({ data: null, error: { status: 500, value: {} }, status: 500 }))
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).message).toBe('Request failed (500)')
  })
})
