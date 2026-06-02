import type { HTMLAttributes } from 'react'
import { cn } from './lib/cn.ts'

export type BadgeTone = 'neutral' | 'walnut' | 'emerald' | 'amber' | 'red' | 'purple' | 'indigo'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-neutral-700 bg-neutral-800/50 text-neutral-300',
  walnut: 'border-walnut-500/30 bg-walnut-500/10 text-walnut-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/12 text-amber-300',
  red: 'border-red-500/30 bg-red-500/12 text-red-300',
  purple: 'border-purple-500/30 bg-purple-500/12 text-purple-300',
  indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
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
