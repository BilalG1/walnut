import type { DatabaseViewerApi } from '../core/useDatabaseViewer.ts'
import { cx } from './cx.ts'
import { useSkin } from './skin.tsx'
import { formatCount } from './util.ts'

/** The header strip above the grid: the active table's qualified name, its estimated row count,
 * and a refresh action. */
export function Toolbar({ api }: { api: DatabaseViewerApi }) {
  const skin = useSkin()
  const { activeTable, refresh, rowsStatus } = api

  return (
    <div className={cx('wdv-toolbar', skin.classNames.toolbar)}>
      <div className="wdv-toolbar-title">
        {activeTable !== null ? (
          <span className="wdv-table-name">
            {activeTable.schema}.{activeTable.name}
          </span>
        ) : null}
        {activeTable?.estimatedRows != null ? (
          <span className="wdv-table-est">~{formatCount(activeTable.estimatedRows)} rows</span>
        ) : null}
        {/* A subtle in-flight cue: rows persist during a sort/page reload, so without this the
            grid looks frozen. */}
        {rowsStatus === 'loading' ? <skin.Spinner className="wdv-toolbar-spinner" /> : null}
      </div>
      <button type="button" className="wdv-refresh" onClick={refresh}>
        Refresh
      </button>
    </div>
  )
}
