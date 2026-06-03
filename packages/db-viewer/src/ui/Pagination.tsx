import type { DatabaseViewerApi } from '../core/useDatabaseViewer.ts'
import { cx } from './cx.ts'
import { useSkin } from './skin.tsx'

/** Prev/next paging with a row-range label. Buttons disable at the boundaries: prev at the first
 * page, next when the over-fetch probe found no further rows. */
export function Pagination({ api }: { api: DatabaseViewerApi }) {
  const skin = useSkin()
  const { page, pageInfo, rows, nextPage, prevPage } = api

  const offset = page.kind === 'offset' ? page.offset : 0
  const hasNext = pageInfo?.hasNext ?? false
  const hasPrev = page.kind === 'offset' ? offset > 0 : (pageInfo?.hasPrev ?? false)

  const start = rows.length === 0 ? 0 : offset + 1
  const end = offset + rows.length
  const total = pageInfo?.total ?? null

  return (
    <div className={cx('wdv-pagination', skin.classNames.pagination)}>
      <span className="wdv-range">
        {start}–{end}
        {total !== null ? ` of ${total.toLocaleString('en-US')}` : ''}
      </span>
      <div className="wdv-pager">
        <button type="button" className="wdv-pager-btn" onClick={prevPage} disabled={!hasPrev}>
          Prev
        </button>
        <button type="button" className="wdv-pager-btn" onClick={nextPage} disabled={!hasNext}>
          Next
        </button>
      </div>
    </div>
  )
}
