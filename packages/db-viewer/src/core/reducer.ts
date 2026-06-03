import type {
  CellValue,
  ColumnMeta,
  Filter,
  PageInfo,
  PageRequest,
  RowsResult,
  SortSpec,
  TableRef,
} from '../types.ts'
import { firstOffsetPage } from './paginate.ts'

export type LoadStatus = 'idle' | 'loading' | 'error'

/**
 * The viewer's full state. Kept as a plain object reduced by {@link viewerReducer} so every
 * transition (table selection, the sort cycle, pagination) is a pure function we can test
 * without React or a database. The hook ({@link useDatabaseViewer}) owns the async side and
 * dispatches `*_loaded` / `*_error` when promises settle.
 */
export interface ViewerState {
  tables: TableRef[]
  tablesStatus: LoadStatus
  activeTable: TableRef | null
  columns: ColumnMeta[]
  rows: CellValue[][]
  sort: SortSpec[]
  filters: Filter[]
  page: PageRequest
  pageInfo: PageInfo | null
  pageSize: number
  rowsStatus: LoadStatus
  error: string | null
}

export type ViewerAction =
  | { type: 'tables_loading' }
  | { type: 'tables_loaded'; tables: TableRef[] }
  | { type: 'tables_error'; error: string }
  | { type: 'select_table'; table: TableRef }
  | { type: 'columns_loaded'; columns: ColumnMeta[] }
  | { type: 'rows_loading' }
  | { type: 'rows_loaded'; result: RowsResult }
  | { type: 'rows_error'; error: string }
  | { type: 'toggle_sort'; column: string }
  | { type: 'set_sort'; sort: SortSpec[] }
  | { type: 'set_filters'; filters: Filter[] }
  | { type: 'page_next' }
  | { type: 'page_prev' }

export function createInitialState(pageSize: number): ViewerState {
  return {
    tables: [],
    tablesStatus: 'idle',
    activeTable: null,
    columns: [],
    rows: [],
    sort: [],
    filters: [],
    page: firstOffsetPage(pageSize),
    pageInfo: null,
    pageSize,
    rowsStatus: 'idle',
    error: null,
  }
}

/**
 * Cycle a single-column sort: unsorted → asc → desc → unsorted. Clicking a *different*
 * column starts it fresh at ascending. Multi-column sort is set explicitly via `set_sort`.
 */
export function cycleSort(current: SortSpec[], column: string): SortSpec[] {
  const existing = current.length === 1 && current[0]?.column === column ? current[0] : null
  if (existing === null) {
    return [{ column, direction: 'asc' }]
  }
  if (existing.direction === 'asc') {
    return [{ column, direction: 'desc' }]
  }
  return []
}

/** Reset to the first offset page — used whenever the result set changes (sort/filter/table). */
function resetPage(state: ViewerState): PageRequest {
  return firstOffsetPage(state.pageSize)
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'tables_loading':
      return { ...state, tablesStatus: 'loading', error: null }
    case 'tables_loaded':
      return { ...state, tables: action.tables, tablesStatus: 'idle' }
    case 'tables_error':
      return { ...state, tablesStatus: 'error', error: action.error }
    case 'select_table':
      return {
        ...state,
        activeTable: action.table,
        columns: [],
        rows: [],
        sort: [],
        filters: [],
        page: resetPage(state),
        pageInfo: null,
        rowsStatus: 'loading',
        error: null,
      }
    case 'columns_loaded':
      return { ...state, columns: action.columns }
    case 'rows_loading':
      return { ...state, rowsStatus: 'loading', error: null }
    case 'rows_loaded':
      return {
        ...state,
        columns: action.result.columns.length > 0 ? action.result.columns : state.columns,
        rows: action.result.rows,
        pageInfo: action.result.page,
        rowsStatus: 'idle',
        error: null,
      }
    case 'rows_error':
      return { ...state, rowsStatus: 'error', error: action.error }
    case 'toggle_sort':
      return {
        ...state,
        sort: cycleSort(state.sort, action.column),
        page: resetPage(state),
        rowsStatus: 'loading',
      }
    case 'set_sort':
      return { ...state, sort: action.sort, page: resetPage(state), rowsStatus: 'loading' }
    case 'set_filters':
      return { ...state, filters: action.filters, page: resetPage(state), rowsStatus: 'loading' }
    case 'page_next':
      return { ...state, page: nextPage(state), rowsStatus: 'loading' }
    case 'page_prev':
      return { ...state, page: prevPage(state), rowsStatus: 'loading' }
  }
}

/** Advance one page. Offset mode steps forward by the limit (guarded by `hasNext`); cursor
 * mode follows the server-provided `nextCursor`. A no-op when there is no next page. */
function nextPage(state: ViewerState): PageRequest {
  const { page, pageInfo } = state
  if (pageInfo === null || !pageInfo.hasNext) {
    return page
  }
  if (page.kind === 'offset') {
    return { ...page, offset: page.offset + page.limit }
  }
  return { ...page, after: pageInfo.nextCursor ?? null }
}

/** Step back one page. Offset mode only in v1 (cursor mode has no cheap reverse); a no-op at
 * the start. */
function prevPage(state: ViewerState): PageRequest {
  const { page } = state
  if (page.kind !== 'offset') {
    return page
  }
  if (page.offset <= 0) {
    return page
  }
  return { ...page, offset: Math.max(0, page.offset - page.limit) }
}
