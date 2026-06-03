import type { ReactNode } from 'react'
import type { CellValue, ColumnMeta } from '../types.ts'

/**
 * The four tiers of customizability, as plain prop types:
 *  1. CSS variables (`--wdv-*`) — handled entirely in `styles.css`, no types needed.
 *  2. `ViewerClassNames` — per-slot class overrides, appended after the defaults.
 *  3. `ViewerComponents` — swap whole sub-components (spinner, empty, error) for the host's.
 *  4. `renderCell` / `renderHeader` — full control over cell and header content.
 */

/** Per-slot class overrides. Each is appended to the slot's built-in classes. */
export interface ViewerClassNames {
  root?: string
  sidebar?: string
  sidebarItem?: string
  filter?: string
  main?: string
  toolbar?: string
  grid?: string
  table?: string
  headerRow?: string
  headerCell?: string
  row?: string
  cell?: string
  pagination?: string
}

export interface SpinnerProps {
  className?: string
}
export interface EmptyProps {
  title: string
  hint?: ReactNode
}
export interface ErrorStateProps {
  message: string
}

/** Replaceable sub-components. The prop shapes intentionally match `@walnut/ui`'s `Spinner` /
 * `EmptyState`, so the dashboard can pass those straight through to make the viewer match. */
export interface ViewerComponents {
  Spinner?: (props: SpinnerProps) => ReactNode
  Empty?: (props: EmptyProps) => ReactNode
  ErrorState?: (props: ErrorStateProps) => ReactNode
}

export type RenderCell = (value: CellValue, column: ColumnMeta) => ReactNode
export type RenderHeader = (column: ColumnMeta) => ReactNode
