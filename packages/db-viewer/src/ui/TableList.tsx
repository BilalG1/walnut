import { useState } from 'react'
import type { DatabaseViewerApi } from '../core/useDatabaseViewer.ts'
import { cx } from './cx.ts'
import { useSkin } from './skin.tsx'
import { formatCount } from './util.ts'

/** The sidebar: a filterable list of tables. Selecting one drives the rest of the viewer. */
export function TableList({ api }: { api: DatabaseViewerApi }) {
  const skin = useSkin()
  const { tables, activeTable, selectTable, tablesStatus, error } = api
  const [filter, setFilter] = useState('')

  const needle = filter.trim().toLowerCase()
  const visible =
    needle === '' ? tables : tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(needle))

  return (
    <aside className={cx('wdv-sidebar', skin.classNames.sidebar)}>
      <input
        className={cx('wdv-filter', skin.classNames.filter)}
        placeholder="Filter tables"
        aria-label="Filter tables"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="wdv-table-list">
        {tablesStatus === 'loading' && tables.length === 0 ? (
          <div className="wdv-grid-state">
            <skin.Spinner />
          </div>
        ) : tablesStatus === 'error' ? (
          <skin.ErrorState message={error ?? 'Failed to load tables'} />
        ) : visible.length === 0 ? (
          <skin.Empty title={needle === '' ? 'No tables' : 'No matches'} />
        ) : (
          <ul className="wdv-table-ul">
            {visible.map((table) => {
              const isActive = activeTable?.schema === table.schema && activeTable?.name === table.name
              return (
                <li key={`${table.schema}.${table.name}`}>
                  <button
                    type="button"
                    aria-current={isActive ? 'true' : undefined}
                    className={cx('wdv-table-item', skin.classNames.sidebarItem, isActive && 'wdv-table-item-active')}
                    onClick={() => selectTable(table)}
                  >
                    <span className="wdv-table-item-name">{table.name}</span>
                    {table.estimatedRows != null ? (
                      <span className="wdv-table-item-count">{formatCount(table.estimatedRows)}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
