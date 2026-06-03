import { describe, expect, test } from 'bun:test'
import { createInitialState, cycleSort, viewerReducer, type ViewerState } from '../src/core/reducer.ts'
import type { PageInfo, RowsResult, TableRef } from '../src/types.ts'

const TABLE: TableRef = { schema: 'public', name: 'agents', kind: 'table', estimatedRows: 100 }

function withActiveTable(): ViewerState {
  return viewerReducer(createInitialState(25), { type: 'select_table', table: TABLE })
}

describe('cycleSort', () => {
  test('cycles unsorted → asc → desc → unsorted for one column', () => {
    const asc = cycleSort([], 'name')
    expect(asc).toEqual([{ column: 'name', direction: 'asc' }])
    const desc = cycleSort(asc, 'name')
    expect(desc).toEqual([{ column: 'name', direction: 'desc' }])
    const cleared = cycleSort(desc, 'name')
    expect(cleared).toEqual([])
  })

  test('starts a different column fresh at ascending', () => {
    const next = cycleSort([{ column: 'name', direction: 'desc' }], 'created_at')
    expect(next).toEqual([{ column: 'created_at', direction: 'asc' }])
  })

  test('treats a multi-column sort as not matching, restarting at ascending', () => {
    const multi = [
      { column: 'a', direction: 'asc' as const },
      { column: 'b', direction: 'asc' as const },
    ]
    expect(cycleSort(multi, 'a')).toEqual([{ column: 'a', direction: 'asc' }])
  })
})

describe('viewerReducer', () => {
  test('tables lifecycle', () => {
    let s = createInitialState(25)
    s = viewerReducer(s, { type: 'tables_loading' })
    expect(s.tablesStatus).toBe('loading')
    s = viewerReducer(s, { type: 'tables_loaded', tables: [TABLE] })
    expect(s.tablesStatus).toBe('idle')
    expect(s.tables).toEqual([TABLE])
  })

  test('select_table resets sort/filters/page and enters loading', () => {
    let s = createInitialState(25)
    s = viewerReducer(s, { type: 'set_sort', sort: [{ column: 'x', direction: 'desc' }] })
    s = viewerReducer(s, { type: 'page_next' }) // no pageInfo yet → no-op, still offset 0
    s = viewerReducer(s, { type: 'select_table', table: TABLE })
    expect(s.activeTable).toEqual(TABLE)
    expect(s.sort).toEqual([])
    expect(s.filters).toEqual([])
    expect(s.page).toEqual({ kind: 'offset', limit: 25, offset: 0, withTotal: false })
    expect(s.rowsStatus).toBe('loading')
    expect(s.rows).toEqual([])
  })

  test('rows_loaded stores rows, columns and page info', () => {
    const result: RowsResult = {
      columns: [
        {
          name: 'id',
          kind: 'bigint',
          udtName: 'int8',
          nullable: false,
          isPrimaryKey: true,
          default: null,
          references: null,
        },
      ],
      rows: [[{ k: 'bigint', v: '1' }]],
      page: { total: 1, hasNext: false, hasPrev: false },
    }
    let s = withActiveTable()
    s = viewerReducer(s, { type: 'rows_loaded', result })
    expect(s.rowsStatus).toBe('idle')
    expect(s.rows).toEqual(result.rows)
    expect(s.columns).toEqual(result.columns)
    expect(s.pageInfo).toEqual(result.page)
  })

  test('rows_loaded keeps prior columns when the page echoes none (empty table)', () => {
    const cols = [
      {
        name: 'id',
        kind: 'bigint' as const,
        udtName: 'int8',
        nullable: false,
        isPrimaryKey: true,
        default: null,
        references: null,
      },
    ]
    let s = withActiveTable()
    s = viewerReducer(s, { type: 'columns_loaded', columns: cols })
    s = viewerReducer(s, {
      type: 'rows_loaded',
      result: { columns: [], rows: [], page: { total: 0, hasNext: false, hasPrev: false } },
    })
    expect(s.columns).toEqual(cols)
    expect(s.rows).toEqual([])
  })

  test('toggle_sort cycles and resets to the first page', () => {
    let s = withActiveTable()
    s = viewerReducer(s, { type: 'page_next' }) // still offset 0 without pageInfo
    s = viewerReducer(s, { type: 'toggle_sort', column: 'name' })
    expect(s.sort).toEqual([{ column: 'name', direction: 'asc' }])
    expect(s.page).toEqual({ kind: 'offset', limit: 25, offset: 0, withTotal: false })
    expect(s.rowsStatus).toBe('loading')
  })

  test('page_next advances only when hasNext, page_prev clamps at the start', () => {
    let s = withActiveTable()
    const page: PageInfo = { total: 100, hasNext: true, hasPrev: false }
    s = viewerReducer(s, {
      type: 'rows_loaded',
      result: { columns: [], rows: [], page },
    })
    s = viewerReducer(s, { type: 'page_next' })
    expect(s.page).toMatchObject({ kind: 'offset', offset: 25 })

    // prev from offset 25 → back to 0
    s = viewerReducer(s, { type: 'page_prev' })
    expect(s.page).toMatchObject({ offset: 0 })
    // prev at the start is a no-op
    s = viewerReducer(s, { type: 'page_prev' })
    expect(s.page).toMatchObject({ offset: 0 })
  })

  test('page_next is a no-op when there is no next page', () => {
    let s = withActiveTable()
    s = viewerReducer(s, {
      type: 'rows_loaded',
      result: { columns: [], rows: [], page: { total: 10, hasNext: false, hasPrev: false } },
    })
    const before = s.page
    s = viewerReducer(s, { type: 'page_next' })
    expect(s.page).toEqual(before)
  })

  test('rows_error records the message and error status', () => {
    let s = withActiveTable()
    s = viewerReducer(s, { type: 'rows_error', error: 'boom' })
    expect(s.rowsStatus).toBe('error')
    expect(s.error).toBe('boom')
  })
})
