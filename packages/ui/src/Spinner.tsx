import type { HTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent',
        className,
      )}
      {...props}
    />
  )
}
