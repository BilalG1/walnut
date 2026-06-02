import type { ReactNode } from 'react'
import { cn } from '@walnut/ui'

/** Standard page wrapper. Every route renders into the same max-width and padding so
 * headings line up as you move between tabs — previously each page picked its own
 * `max-w-3xl` / `max-w-5xl` / bare `p-8`, so content jumped horizontally on navigation. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-5xl px-6 py-8', className)}>{children}</div>
}
