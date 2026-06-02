import { Outlet } from '@tanstack/react-router'
import { useScope } from '../../app/useScope.ts'
import { OrgSidebar } from './OrgSidebar.tsx'
import { ProjectSidebar } from './ProjectSidebar.tsx'
import { TopBar } from './TopBar.tsx'

/** App chrome: the top bar plus the scope-appropriate sidebar (org vs project), never
 * both. The page itself renders into the Outlet. */
export function AppLayout() {
  const { orgId, projectId, branch } = useScope()
  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="flex flex-1">
        {orgId === undefined ? null : projectId === undefined ? (
          <OrgSidebar orgId={orgId} />
        ) : (
          <ProjectSidebar orgId={orgId} projectId={projectId} branch={branch ?? 'main'} />
        )}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
