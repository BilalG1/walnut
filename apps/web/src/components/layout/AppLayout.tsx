import { Outlet } from '@tanstack/react-router'
import { useScope } from '../../app/useScope.ts'
import { useMe } from '../../data/queries.ts'
import { OrgSidebar } from './OrgSidebar.tsx'
import { ProjectSidebar } from './ProjectSidebar.tsx'
import { TopBar } from './TopBar.tsx'

/** App chrome: the top bar plus the scope-appropriate sidebar (org vs project), never
 * both. The page itself renders into the Outlet. */
export function AppLayout() {
  const { orgId, projectId, branch } = useScope()
  const me = useMe()
  // Hide the org sidebar during the first-run wizard so onboarding is a focused, full-bleed
  // flow. Default to "onboarded" until `me` loads so returning users never see a flash of
  // missing nav; the wizard reveals the sidebar the instant it marks onboarding complete.
  const onboarded = me.data ? me.data.onboardingCompletedAt !== null : true
  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="flex flex-1">
        {orgId === undefined ? null : projectId !== undefined ? (
          <ProjectSidebar orgId={orgId} projectId={projectId} branch={branch ?? 'main'} />
        ) : onboarded ? (
          <OrgSidebar orgId={orgId} />
        ) : null}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
