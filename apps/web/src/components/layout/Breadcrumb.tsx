import { useScope } from '../../app/useScope.ts'
import { BranchSelector, OrgSelector, ProjectSelector } from './selectors.tsx'

/** The collapsing breadcrumb: org selector only at org scope; org / project / branch
 * once inside a project. */
export function Breadcrumb() {
  const { orgId, projectId, branch } = useScope()
  if (orgId === undefined) {
    return <span className="text-sm font-medium">Walnut</span>
  }
  return (
    <div className="flex items-center gap-1.5">
      <OrgSelector orgId={orgId} />
      {projectId !== undefined && branch !== undefined ? (
        <>
          <span className="text-lg font-light text-faint">/</span>
          <ProjectSelector orgId={orgId} projectId={projectId} />
          <span className="text-lg font-light text-faint">/</span>
          <BranchSelector orgId={orgId} projectId={projectId} branch={branch} />
        </>
      ) : null}
    </div>
  )
}
