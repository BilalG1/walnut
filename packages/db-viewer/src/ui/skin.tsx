import { createContext, useContext, type ReactNode } from 'react'
import type { EmptyProps, ErrorStateProps, RenderCell, RenderHeader, SpinnerProps, ViewerClassNames } from './slots.ts'

/** The resolved skin shared down the component tree via context — defaults already filled in,
 * so sub-components never branch on whether a host override exists. */
export interface ResolvedSkin {
  classNames: ViewerClassNames
  Spinner: (props: SpinnerProps) => ReactNode
  Empty: (props: EmptyProps) => ReactNode
  ErrorState: (props: ErrorStateProps) => ReactNode
  renderCell?: RenderCell
  renderHeader?: RenderHeader
}

const SkinContext = createContext<ResolvedSkin | null>(null)

export const SkinProvider = SkinContext.Provider

export function useSkin(): ResolvedSkin {
  const skin = useContext(SkinContext)
  if (skin === null) {
    throw new Error('db-viewer components must be rendered within <DatabaseViewer>')
  }
  return skin
}
