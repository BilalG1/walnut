import type { HTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
}

export function Separator({ orientation = 'horizontal', className, ...props }: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', 'bg-line', className)}
      {...props}
    />
  )
}
