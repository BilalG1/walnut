import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Source text; the first character becomes the displayed initial. */
  label: string
  /** Square size in px (default 24). */
  size?: number
  /** Tailwind gradient classes, e.g. `from-indigo-400 to-sky-600`. */
  gradient?: string
}

export function Avatar({
  label,
  size = 24,
  gradient = 'from-walnut-400 to-walnut-600',
  className,
  style,
  ...props
}: AvatarProps) {
  const initial = label.trim().charAt(0).toUpperCase() || '?'
  const sizing: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-md bg-gradient-to-br font-bold text-white',
        gradient,
        className,
      )}
      style={{ ...sizing, ...style }}
      {...props}
    >
      {initial}
    </span>
  )
}
