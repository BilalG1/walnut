import type { HTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export type BadgeTone = 'neutral' | 'walnut' | 'emerald' | 'amber' | 'red' | 'purple' | 'indigo'

// Each tone carries a light recipe (saturated text on a pale tint) and a dark `dark:`
// recipe (the original light-on-translucent look), so badges stay legible on either canvas.
const TONES: Record<BadgeTone, string> = {
  neutral:
    'border-line-strong bg-sunken text-muted dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-300',
  walnut:
    'border-walnut-300 bg-walnut-100 text-walnut-700 dark:border-walnut-500/30 dark:bg-walnut-500/10 dark:text-walnut-300',
  emerald:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300',
  amber:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300',
  red: 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/12 dark:text-red-300',
  purple:
    'border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/12 dark:text-purple-300',
  indigo:
    'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  mono?: boolean
}

export function Badge({ tone = 'neutral', mono = false, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-none',
        mono ? 'font-mono' : null,
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}
