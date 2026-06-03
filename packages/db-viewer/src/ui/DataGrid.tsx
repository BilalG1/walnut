import type { DatabaseViewerApi } from '../core/useDatabaseViewer.ts'
import { Cell } from './Cell.tsx'
import { cx } from './cx.ts'
import { HeaderCell } from './HeaderCell.tsx'
import { useSkin } from './skin.tsx'

/** The scrollable data table: a sticky header of sortable columns over the current page of rows,
 * with loading / empty / error states layered beneath. */
export function DataGrid({ api }: { api: DatabaseViewerApi }) {
  const skin = useSkin()
  const { columns, rows, rowsStatus, error } = api

  if (rowsStatus === 'error') {
    return (
      <div className={cx('wdv-grid', skin.classNames.grid)}>
        <skin.ErrorState message={error ?? 'Failed to load rows'} />
      </div>
    )
  }

  const showSpinner = rowsStatus === 'loading' && rows.length === 0
  const showEmpty = rowsStatus === 'idle' && rows.length === 0

  return (
    <div className={cx('wdv-grid', skin.classNames.grid)} aria-busy={rowsStatus === 'loading'}>
      <table className={cx('wdv-table', skin.classNames.table)}>
        <thead>
          <tr className={cx('wdv-header-row', skin.classNames.headerRow)}>
            {columns.map((column) => (
              <HeaderCell
                key={column.name}
                column={column}
                sort={api.sort}
                onToggle={api.toggleSort}
                className={skin.classNames.headerCell}
                renderHeader={skin.renderHeader}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={cx('wdv-row', skin.classNames.row)}>
              {row.map((value, colIndex) => {
                const column = columns[colIndex]
                return (
                  <td key={colIndex} className={cx('wdv-td', skin.classNames.cell)}>
                    {column !== undefined ? <Cell value={value} column={column} render={skin.renderCell} /> : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {showSpinner ? (
        <div className="wdv-grid-state">
          <skin.Spinner />
        </div>
      ) : null}
      {showEmpty ? (
        <div className="wdv-grid-state">
          <skin.Empty title="No rows" hint="This table has no rows to show." />
        </div>
      ) : null}
    </div>
  )
}
