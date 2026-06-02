import { useParams } from '@tanstack/react-router'

/** The org / project / branch the current route is scoped to (any may be absent). */
export interface Scope {
  orgId: string | undefined
  projectId: string | undefined
  branch: string | undefined
}

/**
 * Read the active scope from the URL. `strict: false` returns the merged params across
 * the matched route chain, so this works from the shared layout regardless of depth.
 * Project scope ⇔ `projectId` is present (the breadcrumb collapses to the org otherwise).
 */
export function useScope(): Scope {
  const params = useParams({ strict: false }) as Partial<Record<'orgId' | 'projectId' | 'branch', string>>
  return { orgId: params.orgId, projectId: params.projectId, branch: params.branch }
}
