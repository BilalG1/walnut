import { useState } from 'react'
import { formatCell } from '../core/format.ts'
import type { CellValue, ColumnMeta } from '../types.ts'
import { cx } from './cx.ts'
import type { RenderCell } from './slots.ts'

/** Values whose text is longer than this collapse behind a click-to-expand button. */
const EXPAND_THRESHOLD = 80
const TOOLTIP_THRESHOLD = 24

export interface CellProps {
  value: CellValue
  column: ColumnMeta
  render?: RenderCell
}

/**
 * Render one cell. NULL is styled distinctly from an empty string; bigints/json/etc. each get a
 * `wdv-cell-<kind>` class for monospace/alignment hooks; long values collapse behind a
 * click-to-expand button. A `render` override bypasses all of this.
 */
export function Cell({ value, column, render }: CellProps) {
  const [expanded, setExpanded] = useState(false)
  // The grid keys rows positionally, so a Cell instance is reused as the underlying value
  // changes (paging/sorting/switching tables). Collapse when the value changes so an expansion
  // can't leak onto an unrelated row. Every fetch produces fresh CellValue objects, so identity
  // comparison is the right signal.
  const [renderedValue, setRenderedValue] = useState(value)
  if (renderedValue !== value) {
    setRenderedValue(value)
    setExpanded(false)
  }

  if (render !== undefined) {
    return <>{render(value, column)}</>
  }

  if (value.k === 'null') {
    return <span className="wdv-cell wdv-null">NULL</span>
  }

  const text = formatCell(value)
  const expandable = text.length > EXPAND_THRESHOLD

  if (expandable) {
    return (
      <button
        type="button"
        className={cx('wdv-cell', 'wdv-cell-expandable', `wdv-cell-${value.k}`)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse value' : 'Expand value'}
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? undefined : text}
      >
        {expanded ? (
          <pre className="wdv-cell-full">{text}</pre>
        ) : (
          <span className="wdv-cell-truncated">{text}</span>
        )}
      </button>
    )
  }

  return (
    <span className={cx('wdv-cell', `wdv-cell-${value.k}`)} title={text.length > TOOLTIP_THRESHOLD ? text : undefined}>
      {text}
    </span>
  )
}
