import type { ButtonHTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export type ButtonVariant = 'primary' | 'success' | 'ghost' | 'danger' | 'subtle'
export type ButtonSize = 'sm' | 'md' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-walnut-500 text-white hover:bg-walnut-600 shadow-sm',
  success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm',
  ghost: 'border border-line-strong text-fg hover:bg-hover',
  danger: 'border border-red-500/30 text-danger hover:bg-red-500/10',
  subtle: 'text-muted hover:text-fg',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 px-2.5 text-xs',
  md: 'h-8 gap-1.5 px-3 text-sm',
  icon: 'h-8 w-8',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      // eslint-disable-next-line react/button-has-type -- type is constrained by the prop default
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-walnut-500/50 disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
