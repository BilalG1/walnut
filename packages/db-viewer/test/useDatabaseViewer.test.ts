import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'bun:test'
import { useDatabaseViewer } from '../src/core/useDatabaseViewer.ts'
import type {
  AdapterCapabilities,
  ColumnMeta,
  DatabaseViewerAdapter,
  RowsRequest,
  RowsResult,
  TableRef,
} from '../src/types.ts'

const CAPS: AdapterCapabilities = {
  cursor: true,
  totalCount: true,
  filters: true,
  rawSql: false,
  mutate: false,
  schemas: ['public'],
}

const COLS: ColumnMeta[] = [
  { name: 'label', kind: 'text', udtName: 'text', nullable: true, isPrimaryKey: false, default: null, references: null },
]

function table(name: string): TableRef {
  return { schema: 'public', name, kind: 'table', estimatedRows: 0 }
}

function resultFor(name: string): RowsResult {
  return { columns: COLS, rows: [[{ k: 'text', v: name }]], page: { total: null, hasNext: false, hasPrev: false } }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useDatabaseViewer', () => {
  test('loads tables, auto-selects the first, and loads its rows', async () => {
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha'), table('beta')],
      getColumns: async () => COLS,
      getRows: async (req) => resultFor(req.table.name),
    }
    const { result } = renderHook(() => useDatabaseViewer({ adapter }))

    await waitFor(() => expect(result.current.activeTable?.name).toBe('alpha'))
    await waitFor(() => expect(result.current.rowsStatus).toBe('idle'))
    expect(result.current.tables).toHaveLength(2)
    expect(result.current.rows).toEqual([[{ k: 'text', v: 'alpha' }]])
    expect(result.current.columns).toEqual(COLS)
  })

  test('honors initialTable when present', async () => {
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha'), table('beta')],
      getColumns: async () => COLS,
      getRows: async (req) => resultFor(req.table.name),
    }
    const { result } = renderHook(() =>
      useDatabaseViewer({ adapter, initialTable: { schema: 'public', name: 'beta' } }),
    )
    await waitFor(() => expect(result.current.activeTable?.name).toBe('beta'))
  })

  test('a slow earlier request never clobbers a faster later one', async () => {
    const deferreds: Record<string, Deferred<RowsResult>> = {}
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha')],
      getColumns: async () => COLS,
      getRows: (req) => {
        const d = deferred<RowsResult>()
        deferreds[req.table.name] = d
        return d.promise
      },
    }
    const { result } = renderHook(() => useDatabaseViewer({ adapter }))

    // Auto-selected 'alpha'; its fetch is pending.
    await waitFor(() => expect(deferreds.alpha).toBeDefined())

    // Switch to 'beta' before 'alpha' resolves.
    act(() => result.current.selectTable(table('beta')))
    await waitFor(() => expect(deferreds.beta).toBeDefined())

    // Resolve the *later* request (beta) first — it should win.
    await act(async () => {
      deferreds.beta?.resolve(resultFor('beta'))
      await deferreds.beta?.promise
    })
    await waitFor(() => expect(result.current.rows).toEqual([[{ k: 'text', v: 'beta' }]]))

    // Now resolve the stale earlier request (alpha) — it must be ignored.
    await act(async () => {
      deferreds.alpha?.resolve(resultFor('alpha'))
      await deferreds.alpha?.promise
    })
    expect(result.current.rows).toEqual([[{ k: 'text', v: 'beta' }]])
  })

  test('surfaces an error and recovers on refresh', async () => {
    let attempt = 0
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha')],
      getColumns: async () => COLS,
      getRows: async (req) => {
        attempt += 1
        if (attempt === 1) {
          throw new Error('boom')
        }
        return resultFor(req.table.name)
      },
    }
    const { result } = renderHook(() => useDatabaseViewer({ adapter }))

    await waitFor(() => expect(result.current.rowsStatus).toBe('error'))
    expect(result.current.error).toBe('boom')

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.rowsStatus).toBe('idle'))
    expect(result.current.rows).toEqual([[{ k: 'text', v: 'alpha' }]])
  })

  test('refresh re-fetches the current page without resetting the table or sort', async () => {
    const requests: RowsRequest[] = []
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha'), table('beta')],
      getColumns: async () => COLS,
      getRows: async (req) => {
        requests.push(req)
        return resultFor(req.table.name)
      },
    }
    const { result } = renderHook(() => useDatabaseViewer({ adapter }))
    await waitFor(() => expect(result.current.activeTable?.name).toBe('alpha'))

    act(() => result.current.selectTable(table('beta')))
    await waitFor(() => expect(result.current.activeTable?.name).toBe('beta'))
    act(() => result.current.toggleSort('label'))
    await waitFor(() => expect(result.current.sort).toEqual([{ column: 'label', direction: 'asc' }]))

    const before = requests.length
    act(() => result.current.refresh())
    await waitFor(() => expect(requests.length).toBeGreaterThan(before))

    // The whole point of the fix: refresh re-fetches the current page; it must NOT snap back to
    // the first table or drop the sort.
    expect(result.current.activeTable?.name).toBe('beta')
    expect(result.current.sort).toEqual([{ column: 'label', direction: 'asc' }])
    expect(requests.at(-1)?.table.name).toBe('beta')
    expect(requests.at(-1)?.sort).toEqual([{ column: 'label', direction: 'asc' }])
  })

  test('reloadTables keeps the active table when it still exists in the new list', async () => {
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha'), table('beta')],
      getColumns: async () => COLS,
      getRows: async (req) => resultFor(req.table.name),
    }
    const { result } = renderHook(() => useDatabaseViewer({ adapter }))
    await waitFor(() => expect(result.current.activeTable?.name).toBe('alpha'))
    act(() => result.current.selectTable(table('beta')))
    await waitFor(() => expect(result.current.activeTable?.name).toBe('beta'))

    act(() => result.current.reloadTables())
    // The list reloaded but 'beta' still exists, so the selection is preserved (not reset to alpha).
    await waitFor(() => expect(result.current.tablesStatus).toBe('idle'))
    expect(result.current.activeTable?.name).toBe('beta')
  })

  test('aborts the in-flight request on unmount', async () => {
    let captured: AbortSignal | undefined
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => [table('alpha')],
      getColumns: async () => COLS,
      getRows: (req) => {
        captured = req.signal
        return new Promise<RowsResult>(() => {
          // never resolves — we only care that the signal aborts on unmount
        })
      },
    }
    const { unmount } = renderHook(() => useDatabaseViewer({ adapter }))
    await waitFor(() => expect(captured).toBeDefined())
    expect(captured?.aborted).toBe(false)
    unmount()
    expect(captured?.aborted).toBe(true)
  })
})
