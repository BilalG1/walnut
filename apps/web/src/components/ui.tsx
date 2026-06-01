import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'danger' | 'ghost' | 'subtle'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-walnut-500 text-white hover:bg-walnut-600 shadow-sm',
  danger: 'bg-red-600/90 text-white hover:bg-red-600',
  ghost: 'border border-neutral-700 text-neutral-100 hover:bg-neutral-800',
  subtle: 'text-neutral-400 hover:text-neutral-100',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed'
  return <button type="button" className={`${base} ${BUTTON_VARIANTS[variant]} ${className}`} {...props} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-neutral-800 bg-neutral-900/60 ${className}`}>{children}</div>
  )
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-walnut-500 ${className}`}
      {...props}
    />
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-500">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-walnut-400" />
      {label !== undefined && <span>{label}</span>}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 px-6 py-10 text-center">
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  provisioning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  denied: 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30',
}

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  )
}
