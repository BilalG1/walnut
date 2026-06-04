import { Link } from '@tanstack/react-router'
import { ArrowLeft, Building, GitBranch, LayoutGrid } from '@walnut/icons'
import { Button, Spinner } from '@walnut/ui'
import type { ReactNode } from 'react'
import { useScope } from '../../app/useScope.ts'
import type { MissingResource, ScopeGuardResult } from '../../app/useScopeGuard.ts'
import { useBranches, useOrganizations } from '../../data/queries.ts'

/** Centered, full-height frame shared by every boundary state (so they sit consistently in the
 * main content area beside the chrome). */
function Frame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-12 text-center">{children}</div>
}

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-hover text-subtle">{children}</div>
  )
}

/** Render whichever non-`ok` boundary state the guard reported. `AppLayout` renders this in place
 * of the page (and suppresses the scope sidebar) so a bad scope is a clear, actionable dead-end
 * rather than a page wrapped around a missing resource. */
export function ScopeBoundary({ result }: { result: Exclude<ScopeGuardResult, { status: 'ok' }> }) {
  if (result.status === 'loading') {
    return (
      <Frame>
        <Spinner />
      </Frame>
    )
  }
  if (result.status === 'error') {
    return <ScopeError error={result.error} retry={result.retry} />
  }
  return <ScopeNotFound resource={result.resource} />
}

/** A genuine fault (500, network) — distinct from not-found so we never tell someone their org
 * "doesn't exist" when the server merely errored. Offers a retry, not a way out. */
function ScopeError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
  return (
    <Frame>
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-subtle">{message}</p>
      <Button className="mt-6" onClick={retry}>
        Try again
      </Button>
    </Frame>
  )
}

function ScopeNotFound({ resource }: { resource: MissingResource }) {
  if (resource === 'organization') {
    return <OrgNotFound />
  }
  if (resource === 'project') {
    return <ProjectNotFound />
  }
  return <BranchNotFound />
}

function OrgNotFound() {
  const { data: orgs } = useOrganizations()
  const rows = orgs ?? []
  return (
    <Frame>
      <IconBadge>
        <Building size={26} />
      </IconBadge>
      <h1 className="text-xl font-semibold tracking-tight">Organization not found</h1>
      <p className="mt-2 max-w-md text-sm text-subtle">
        This organization doesn&apos;t exist, or you don&apos;t have access to it. Pick one of your
        organizations to continue — or use the switcher in the top bar.
      </p>
      {rows.length > 0 ? (
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
          {rows.map((o) => (
            <Link key={o.id} to="/orgs/$orgId" params={{ orgId: o.id }} className="w-full">
              <Button variant="ghost" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Building size={15} className="text-subtle" />
                  {o.name}
                </span>
                {o.isPersonal ? <span className="text-[10px] text-subtle">personal</span> : null}
              </Button>
            </Link>
          ))}
        </div>
      ) : null}
    </Frame>
  )
}

function ProjectNotFound() {
  const { orgId } = useScope()
  return (
    <Frame>
      <IconBadge>
        <LayoutGrid size={26} />
      </IconBadge>
      <h1 className="text-xl font-semibold tracking-tight">Project not found</h1>
      <p className="mt-2 max-w-md text-sm text-subtle">
        This project doesn&apos;t exist, or you don&apos;t have access to it. It may have been
        deleted.
      </p>
      {orgId !== undefined ? (
        <Link to="/orgs/$orgId" params={{ orgId }} className="mt-6">
          <Button>
            <ArrowLeft size={15} />
            Back to projects
          </Button>
        </Link>
      ) : null}
    </Frame>
  )
}

function BranchNotFound() {
  const { orgId, projectId, branch } = useScope()
  // The project is valid here (the guard validated it before reaching the branch), so the branch
  // list is loaded and cheap to read — offer the default branch plus any siblings to jump to.
  const { data: branches } = useBranches(projectId ?? '', { enabled: projectId !== undefined })
  const rows = branches ?? []
  const fallback = rows.find((b) => b.isDefault)?.name ?? rows[0]?.name

  return (
    <Frame>
      <IconBadge>
        <GitBranch size={26} />
      </IconBadge>
      <h1 className="text-xl font-semibold tracking-tight">Branch not found</h1>
      <p className="mt-2 max-w-md text-sm text-subtle">
        {branch !== undefined ? (
          <>
            There&apos;s no branch <span className="font-mono text-fg">{branch}</span> in this project.
          </>
        ) : (
          <>That branch doesn&apos;t exist in this project.</>
        )}
      </p>
      {orgId !== undefined && projectId !== undefined && rows.length > 0 ? (
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
          {rows.map((b) => (
            <Link
              key={b.id}
              to="/orgs/$orgId/projects/$projectId/branches/$branch"
              params={{ orgId, projectId, branch: b.name }}
              className="w-full"
            >
              <Button variant={b.name === fallback ? 'primary' : 'ghost'} className="w-full justify-between">
                <span className="flex items-center gap-2 font-mono">
                  <GitBranch size={15} className={b.name === fallback ? '' : 'text-subtle'} />
                  {b.name}
                </span>
                {b.isDefault ? <span className="text-[10px] opacity-70">default</span> : null}
              </Button>
            </Link>
          ))}
        </div>
      ) : null}
    </Frame>
  )
}
