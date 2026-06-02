import { Link } from '@tanstack/react-router'
import { Walnut } from '@walnut/icons'
import { useScope } from '../../app/useScope.ts'
import { BranchSelector, OrgSelector, ProjectSelector } from './selectors.tsx'

/** The collapsing breadcrumb: org selector only at org scope; org / project / branch
 * once inside a project. */
export function Breadcrumb() {
  const { orgId, projectId, branch } = useScope()
  if (orgId === undefined) {
    return (
      <span className="flex items-center gap-2 text-sm font-medium">
        <Walnut size={20} className="text-walnut-400" /> Walnut
      </span>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <Link to="/orgs/$orgId" params={{ orgId }} className="mr-0.5 text-walnut-400" aria-label="Walnut home">
        <Walnut size={20} />
      </Link>
      <OrgSelector orgId={orgId} />
      {projectId !== undefined && branch !== undefined ? (
        <>
          <span className="text-lg font-light text-neutral-700">/</span>
          <ProjectSelector orgId={orgId} projectId={projectId} />
          <span className="text-lg font-light text-neutral-700">/</span>
          <BranchSelector orgId={orgId} projectId={projectId} branch={branch} />
        </>
      ) : null}
    </div>
  )
}
