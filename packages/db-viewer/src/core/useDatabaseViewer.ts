import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  AdapterCapabilities,
  CellValue,
  ColumnMeta,
  DatabaseViewerAdapter,
  Filter,
  PageInfo,
  PageRequest,
  RowsRequest,
  SortSpec,
  TableRef,
} from '../types.ts'
import { DEFAULT_PAGE_SIZE } from './paginate.ts'
import { createInitialState, viewerReducer, type LoadStatus } from './reducer.ts'

export interface UseDatabaseViewerOptions {
  /**
   * The data adapter. **Must be referentially stable** — memoize it (e.g. `useMemo`), or every
   * render re-runs the load effects, looping forever. To point at a different database, give the
   * viewer a new React `key` so it remounts cleanly rather than swapping the adapter in place.
   */
  adapter: DatabaseViewerAdapter
  /** Rows per page. Defaults to 50. Clamped to a positive integer. */
  pageSize?: number
  /** Table to open once the list loads. Matched by schema + name; falls back to the first table. */
  initialTable?: TableRef | { schema: string; name: string }
}

/** The headless API: viewer state plus the actions that drive it. The default `<DatabaseViewer>`
 * is just this hook wired to the bundled skin, so anything it can do, a custom UI can too. */
export interface DatabaseViewerApi {
  tables: TableRef[]
  tablesStatus: LoadStatus
  activeTable: TableRef | null
  columns: ColumnMeta[]
  rows: CellValue[][]
  sort: SortSpec[]
  filters: Filter[]
  page: PageRequest
  pageInfo: PageInfo | null
  rowsStatus: LoadStatus
  error: string | null
  capabilities: AdapterCapabilities
  selectTable: (table: TableRef) => void
  toggleSort: (column: string) => void
  setSort: (sort: SortSpec[]) => void
  setFilters: (filters: Filter[]) => void
  nextPage: () => void
  prevPage: () => void
  /** Re-fetch the current page (e.g. after external data changes). */
  refresh: () => void
  /** Re-fetch the table list. */
  reloadTables: () => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** True for the DOMException browsers raise when a fetch is aborted — never surfaced as an error. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string })?.name === 'AbortError'
}

function resolveInitial(
  tables: TableRef[],
  initial: UseDatabaseViewerOptions['initialTable'],
): TableRef | null {
  if (tables.length === 0) {
    return null
  }
  if (initial !== undefined) {
    const match = tables.find((t) => t.schema === initial.schema && t.name === initial.name)
    if (match !== undefined) {
      return match
    }
  }
  return tables[0] ?? null
}

export function useDatabaseViewer(options: UseDatabaseViewerOptions): DatabaseViewerApi {
  const { adapter } = options
  // Clamp to a sane positive integer so a stray `pageSize={0}` can't poison the offset math.
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE))
  const [state, dispatch] = useReducer(viewerReducer, pageSize, createInitialState)

  // Two independent reload signals. `rowsToken` re-fetches just the current page (refresh());
  // `tablesToken` reloads the table list (reloadTables()). Keeping them separate is what makes
  // refresh() NOT re-run the tables effect — otherwise it would re-select the initial table and
  // throw away the user's sort / filters / page.
  const [rowsToken, setRowsToken] = useState(0)
  const [tablesToken, setTablesToken] = useState(0)

  // Monotonic request id: a settled fetch only writes state if it is still the latest one, so a
  // slow earlier request can never clobber a faster later one (the table-switch race).
  const rowsSeq = useRef(0)

  // The initial table is read once when the list first loads; held in a ref so an inline
  // `{ schema, name }` literal from the host doesn't re-trigger the load every render.
  const initialTableRef = useRef(options.initialTable)

  const { activeTable, sort, filters, page } = state

  // Mirror the active table so the tables effect can preserve the user's selection across a
  // reloadTables() without depending on it (which would re-run the effect on every selection).
  const activeTableRef = useRef(activeTable)
  activeTableRef.current = activeTable

  // Load the table list (and auto-open a table) on mount / adapter change.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    dispatch({ type: 'tables_loading' })
    void (async () => {
      try {
        const tables = await adapter.listTables({ signal: controller.signal })
        if (cancelled) {
          return
        }
        dispatch({ type: 'tables_loaded', tables })
        // Preserve the user's current table across a reloadTables(); only auto-select on first
        // load (no active table) or when the active table has vanished from the new list.
        const current = activeTableRef.current
        const stillPresent =
          current !== null && tables.some((t) => t.schema === current.schema && t.name === current.name)
        if (!stillPresent) {
          const initial = resolveInitial(tables, initialTableRef.current)
          if (initial !== null) {
            dispatch({ type: 'select_table', table: initial })
          }
        }
      } catch (err) {
        if (!cancelled && !isAbort(err)) {
          dispatch({ type: 'tables_error', error: errorMessage(err) })
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [adapter, tablesToken])

  // Load column metadata when the table changes — gives the grid headers immediately, even before
  // rows arrive and even for empty tables. The adapter caches, so this is cheap.
  useEffect(() => {
    if (activeTable === null) {
      return
    }
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      try {
        const columns = await adapter.getColumns(activeTable, { signal: controller.signal })
        if (!cancelled) {
          dispatch({ type: 'columns_loaded', columns })
        }
      } catch {
        // A column-introspection failure is non-fatal; the row fetch surfaces the real error.
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [adapter, activeTable])

  // Fetch the current page whenever the table, sort, filters, page, or refresh token changes.
  useEffect(() => {
    if (activeTable === null) {
      return
    }
    const seq = ++rowsSeq.current
    const controller = new AbortController()
    dispatch({ type: 'rows_loading' })
    const request: RowsRequest = { table: activeTable, sort, filters, page, signal: controller.signal }
    void (async () => {
      try {
        const result = await adapter.getRows(request)
        if (rowsSeq.current === seq) {
          dispatch({ type: 'rows_loaded', result })
        }
      } catch (err) {
        if (rowsSeq.current === seq && !isAbort(err)) {
          dispatch({ type: 'rows_error', error: errorMessage(err) })
        }
      }
    })()
    return () => {
      controller.abort()
    }
  }, [adapter, activeTable, sort, filters, page, rowsToken])

  const selectTable = useCallback((table: TableRef) => dispatch({ type: 'select_table', table }), [])
  const toggleSort = useCallback((column: string) => dispatch({ type: 'toggle_sort', column }), [])
  const setSort = useCallback((next: SortSpec[]) => dispatch({ type: 'set_sort', sort: next }), [])
  const setFilters = useCallback((next: Filter[]) => dispatch({ type: 'set_filters', filters: next }), [])
  const nextPage = useCallback(() => dispatch({ type: 'page_next' }), [])
  const prevPage = useCallback(() => dispatch({ type: 'page_prev' }), [])
  const refresh = useCallback(() => setRowsToken((t) => t + 1), [])
  const reloadTables = useCallback(() => setTablesToken((t) => t + 1), [])

  return {
    tables: state.tables,
    tablesStatus: state.tablesStatus,
    activeTable: state.activeTable,
    columns: state.columns,
    rows: state.rows,
    sort: state.sort,
    filters: state.filters,
    page: state.page,
    pageInfo: state.pageInfo,
    rowsStatus: state.rowsStatus,
    error: state.error,
    capabilities: adapter.capabilities,
    selectTable,
    toggleSort,
    setSort,
    setFilters,
    nextPage,
    prevPage,
    refresh,
    reloadTables,
  }
}
