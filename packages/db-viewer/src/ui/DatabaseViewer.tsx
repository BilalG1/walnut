import { useEffect, useMemo, useRef } from 'react'
import { useDatabaseViewer, type UseDatabaseViewerOptions } from '../core/useDatabaseViewer.ts'
import type { TableRef } from '../types.ts'
import { cx } from './cx.ts'
import { DataGrid } from './DataGrid.tsx'
import { Pagination } from './Pagination.tsx'
import { SkinProvider, type ResolvedSkin } from './skin.tsx'
import type { RenderCell, RenderHeader, ViewerClassNames, ViewerComponents } from './slots.ts'
import { DefaultEmpty, DefaultErrorState, DefaultSpinner } from './states.tsx'
import { TableList } from './TableList.tsx'
import { Toolbar } from './Toolbar.tsx'

export interface DatabaseViewerProps extends UseDatabaseViewerOptions {
  /** Extra class on the root element (in addition to `classNames.root`). */
  className?: string
  /** Per-slot class overrides (tier 2). */
  classNames?: ViewerClassNames
  /** Replaceable sub-components — spinner / empty / error (tier 3). */
  components?: ViewerComponents
  /** Full control over cell content (tier 4). */
  renderCell?: RenderCell
  /** Full control over header content (tier 4). */
  renderHeader?: RenderHeader
  /** Called whenever the active table changes. */
  onTableChange?: (table: TableRef) => void
  /** Called whenever a load error surfaces. */
  onError?: (message: string) => void
}

/**
 * The batteries-included viewer: a table sidebar, a sortable/paginated data grid, and a toolbar,
 * wired to the headless {@link useDatabaseViewer} hook. It's a thin shell over that hook plus the
 * bundled skin — so any layout it produces, a host can reproduce with the hook directly.
 */
export function DatabaseViewer({
  adapter,
  pageSize,
  initialTable,
  className,
  classNames,
  components,
  renderCell,
  renderHeader,
  onTableChange,
  onError,
}: DatabaseViewerProps) {
  const api = useDatabaseViewer({ adapter, pageSize, initialTable })

  const skin: ResolvedSkin = useMemo(
    () => ({
      classNames: classNames ?? {},
      Spinner: components?.Spinner ?? DefaultSpinner,
      Empty: components?.Empty ?? DefaultEmpty,
      ErrorState: components?.ErrorState ?? DefaultErrorState,
      renderCell,
      renderHeader,
    }),
    [classNames, components, renderCell, renderHeader],
  )

  // Hold callbacks in refs so the notify-effects can depend solely on the value that changed,
  // without re-firing when an inline callback's identity changes between renders.
  const onTableChangeRef = useRef(onTableChange)
  onTableChangeRef.current = onTableChange
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const { activeTable, error } = api
  useEffect(() => {
    if (activeTable !== null) {
      onTableChangeRef.current?.(activeTable)
    }
  }, [activeTable])
  useEffect(() => {
    if (error !== null) {
      onErrorRef.current?.(error)
    }
  }, [error])

  return (
    <SkinProvider value={skin}>
      <div className={cx('wdv-root', className, classNames?.root)}>
        <TableList api={api} />
        <div className={cx('wdv-main', classNames?.main)}>
          <Toolbar api={api} />
          <DataGrid api={api} />
          <Pagination api={api} />
        </div>
      </div>
    </SkinProvider>
  )
}
