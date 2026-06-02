import { useEffect, type ReactNode } from 'react'
import { cn } from './lib/cn.ts'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Optional footer (e.g. action buttons), right-aligned. */
  footer?: ReactNode
  className?: string
}

/** A small owned modal dialog: overlay + centered panel, closing on Escape or an
 * overlay click. Controlled via `open`/`onClose`. No external dependency. */
export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  useEffect(() => {
    if (!open) {
      return
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }
  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-2xl border border-line bg-surface shadow-xl shadow-black/10 dark:shadow-2xl dark:shadow-black/50',
          className,
        )}
      >
        {title !== undefined ? (
          <div className="border-b border-line px-5 py-3.5 text-sm font-semibold">{title}</div>
        ) : null}
        <div className="px-5 py-4 text-sm text-fg-secondary">{children}</div>
        {footer !== undefined ? (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
