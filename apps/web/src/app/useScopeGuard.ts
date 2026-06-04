import { ApiError } from '../data/http.ts'
import { useBranches, useOrganizations, useProject } from '../data/queries.ts'
import { useScope } from './useScope.ts'

/** The resource the current URL scope points at that couldn't be resolved. */
export type MissingResource = 'organization' | 'project' | 'branch'

/**
 * The verdict on the org/project/branch in the current URL. `AppLayout` consumes this to either
 * render the page (`ok`) or short-circuit to a focused not-found / error / loading view — so a
 * bad scope never renders a page (or a sidebar full of dead links) around a resource that isn't
 * there.
 */
export type ScopeGuardResult =
  | { status: 'ok' }
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'not-found'; resource: MissingResource }

/** A 404 (missing or no-access) or a 422 (malformed id) both mean "this resource isn't here". */
function isNotFound(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : undefined
  return status === 404 || status === 422
}

/**
 * Validate the URL's scope chain (org → project → branch), short-circuiting at the first level
 * that fails. Org membership is checked against the already-loaded org list (so a bad/typo'd org
 * id never even hits the API); project and branch are validated against their own queries, which
 * the page would fetch anyway, so React Query dedupes and there's no extra request.
 */
export function useScopeGuard(): ScopeGuardResult {
  const { orgId, projectId, branch } = useScope()
  const orgs = useOrganizations()
  // Gated on project scope; `enabled: false` keeps these idle (and dedupes with the page's own
  // copy when active). The placeholder id is never used while disabled.
  const project = useProject(projectId ?? '', { enabled: projectId !== undefined })
  const branches = useBranches(projectId ?? '', { enabled: projectId !== undefined })

  // Unscoped routes (landing, invite redemption) have nothing to validate.
  if (orgId === undefined) {
    return { status: 'ok' }
  }

  // Org: a member sees it in their org list; anything else (missing or no access) is not-found.
  if (orgs.isPending) {
    return { status: 'loading' }
  }
  if (orgs.error !== null) {
    return { status: 'error', error: orgs.error, retry: () => void orgs.refetch() }
  }
  if (!(orgs.data ?? []).some((o) => o.id === orgId)) {
    return { status: 'not-found', resource: 'organization' }
  }

  if (projectId !== undefined) {
    if (project.isPending) {
      return { status: 'loading' }
    }
    if (project.error !== null) {
      return isNotFound(project.error)
        ? { status: 'not-found', resource: 'project' }
        : { status: 'error', error: project.error, retry: () => void project.refetch() }
    }

    if (branch !== undefined) {
      if (branches.isPending) {
        return { status: 'loading' }
      }
      if (branches.error !== null) {
        return isNotFound(branches.error)
          ? { status: 'not-found', resource: 'project' }
          : { status: 'error', error: branches.error, retry: () => void branches.refetch() }
      }
      if (!(branches.data ?? []).some((b) => b.name === branch)) {
        return { status: 'not-found', resource: 'branch' }
      }
    }
  }

  return { status: 'ok' }
}
