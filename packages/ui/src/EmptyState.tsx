import type { ReactNode } from 'react'
import { cn } from './lib/cn.ts'

export interface EmptyStateProps {
  title: string
  /** Optional one-line explanation under the title. */
  hint?: ReactNode
  className?: string
}

/** A consistent placeholder for empty lists and sections — a dashed, centered panel
 * rather than a bare line of muted text, so empty states read as intentional. */
export function EmptyState({ title, hint, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-xl border border-dashed border-neutral-800 px-6 py-12 text-center', className)}>
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {hint !== undefined ? <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500">{hint}</p> : null}
    </div>
  )
}
