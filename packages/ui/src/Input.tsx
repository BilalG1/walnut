import type { InputHTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'h-8 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-walnut-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
