import type { EmptyProps, ErrorStateProps, SpinnerProps } from './slots.ts'
import { cx } from './cx.ts'

/** The built-in fallbacks used when the host doesn't inject its own via `components`. They render
 * inside `<DatabaseViewer>` (i.e. within `.wdv-root`), which supplies the `--wdv-*` variables their
 * classes read. */

export function DefaultSpinner({ className }: SpinnerProps) {
  return <span role="status" aria-label="Loading" className={cx('wdv-spinner', className)} />
}

export function DefaultEmpty({ title, hint }: EmptyProps) {
  return (
    <div className="wdv-empty">
      <p className="wdv-empty-title">{title}</p>
      {hint != null ? <p className="wdv-empty-hint">{hint}</p> : null}
    </div>
  )
}

export function DefaultErrorState({ message }: ErrorStateProps) {
  return (
    <div role="alert" className="wdv-error">
      {message}
    </div>
  )
}
