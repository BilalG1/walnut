import type { ColumnMeta, SortSpec } from '../types.ts'
import { cx } from './cx.ts'
import type { RenderHeader } from './slots.ts'

export interface HeaderCellProps {
  column: ColumnMeta
  sort: SortSpec[]
  onToggle: (column: string) => void
  className?: string
  renderHeader?: RenderHeader
}

/** A sortable column header. Exposes `aria-sort` for assistive tech and shows an arrow + a `PK`
 * marker. Clicking cycles the sort (asc → desc → none) via the hook. */
export function HeaderCell({ column, sort, onToggle, className, renderHeader }: HeaderCellProps) {
  const active = sort.find((s) => s.column === column.name)
  const ariaSort = active === undefined ? 'none' : active.direction === 'asc' ? 'ascending' : 'descending'

  return (
    <th scope="col" aria-sort={ariaSort} className={cx('wdv-th', className)}>
      <button type="button" className="wdv-th-button" onClick={() => onToggle(column.name)}>
        <span className="wdv-th-label">{renderHeader !== undefined ? renderHeader(column) : column.name}</span>
        {column.isPrimaryKey ? (
          <span className="wdv-th-pk" title="Primary key">
            PK
          </span>
        ) : null}
        <span className="wdv-th-indicator" aria-hidden="true">
          {active === undefined ? '' : active.direction === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  )
}
