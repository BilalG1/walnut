import type { InputHTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Optional inline label rendered to the right of the box. */
  label?: string
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  const box = (
    <input
      type="checkbox"
      className={cn('h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-950 accent-walnut-500', className)}
      {...props}
    />
  )
  if (label === undefined) {
    return box
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
      {box}
      {label}
    </label>
  )
}
