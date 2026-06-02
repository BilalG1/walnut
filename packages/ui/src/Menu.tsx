import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from './lib/cn.ts'

interface MenuContextValue {
  close: () => void
}

const MenuContext = createContext<MenuContextValue | null>(null)

export interface MenuProps {
  /** Content of the trigger button. */
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  /** Accessible name for the trigger — required when the trigger has no visible text
   * (e.g. an icon-only or avatar-only trigger). */
  triggerLabel?: string
  /** Extra classes for the trigger button. */
  triggerClassName?: string
  /** Extra classes for the dropdown panel. */
  panelClassName?: string
}

/**
 * A small owned dropdown menu: a trigger button that toggles a popover, closing on
 * outside-click, Escape, or item selection. No external dependency (no Radix); good
 * enough for the dashboard's selectors and action menus.
 */
export function Menu({ trigger, children, align = 'start', triggerLabel, triggerClassName, panelClassName }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const ctxValue = useMemo(() => ({ close }), [close])

  useEffect(() => {
    if (!open) {
      return
    }
    function onPointerDown(event: MouseEvent) {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-walnut-500/50',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-50 mt-1.5 min-w-[14rem] rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-black/10 dark:shadow-2xl dark:shadow-black/50',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          <MenuContext.Provider value={ctxValue}>{children}</MenuContext.Provider>
        </div>
      ) : null}
    </div>
  )
}

export interface MenuItemProps {
  children: ReactNode
  onSelect?: () => void
  active?: boolean
  className?: string
}

export function MenuItem({ children, onSelect, active = false, className }: MenuItemProps) {
  const ctx = useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onSelect?.()
        ctx?.close()
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-walnut-500/10 text-accent' : 'text-fg hover:bg-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
      {children}
    </div>
  )
}

export function MenuSeparator() {
  return <div className="my-1.5 border-t border-line" />
}
