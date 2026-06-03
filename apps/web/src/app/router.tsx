import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppLayout } from '../components/layout/AppLayout.tsx'
import { AcceptInvitePage } from '../features/AcceptInvitePage.tsx'
import { keys } from '../data/keys.ts'
import { fetchMe, fetchOrganizations } from '../data/queries.ts'
import { PlaceholderPage } from '../features/PlaceholderPage.tsx'
import { AgentDetailPage } from '../features/orgs/AgentDetailPage.tsx'
import { AgentsPage } from '../features/orgs/AgentsPage.tsx'
import { GetStartedPage } from '../features/orgs/GetStartedPage.tsx'
import { MembersPage } from '../features/orgs/MembersPage.tsx'
import { ProjectsPage } from '../features/orgs/ProjectsPage.tsx'
import { RequestsPage } from '../features/orgs/RequestsPage.tsx'
import { ActivityPage } from '../features/projects/ActivityPage.tsx'
import { DatabasePage } from '../features/projects/DatabasePage.tsx'
import { DataPage } from '../features/projects/DataPage.tsx'
import { OverviewPage } from '../features/projects/OverviewPage.tsx'
import { BranchSettingsPage } from '../features/projects/BranchSettingsPage.tsx'
import { queryClient } from './queryClient.ts'

const rootRoute = createRootRoute({ component: AppLayout })

/** Landing: send the user to their personal org (or first org). A user who hasn't finished
 * the first-run onboarding lands in the guided get-started flow; everyone else goes straight
 * to the dashboard. Completion is a durable per-user fact (`me.onboardingCompletedAt`), so
 * it survives reloads and doesn't re-trigger just because a project was (or wasn't) created. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async () => {
    const [me, orgs] = await Promise.all([
      queryClient.ensureQueryData({ queryKey: keys.me(), queryFn: fetchMe }),
      queryClient.ensureQueryData({ queryKey: keys.orgs(), queryFn: fetchOrganizations }),
    ])
    const target = orgs.find((o) => o.isPersonal) ?? orgs[0]
    if (target === undefined) {
      return
    }
    throw redirect(
      me.onboardingCompletedAt === null
        ? { to: '/orgs/$orgId/get-started', params: { orgId: target.id } }
        : { to: '/orgs/$orgId', params: { orgId: target.id } },
    )
  },
  component: () => <div className="p-8 text-sm text-subtle">You don&apos;t belong to any organization yet.</div>,
})

// Invite redemption (not org-scoped — the org is resolved from the token) ----
const acceptInviteRoute = createRoute({ getParentRoute: () => rootRoute, path: 'invite/$token', component: AcceptInvitePage })

// Org scope -----------------------------------------------------------------
const orgRoute = createRoute({ getParentRoute: () => rootRoute, path: 'orgs/$orgId' })
const orgIndexRoute = createRoute({ getParentRoute: () => orgRoute, path: '/', component: ProjectsPage })
const orgGetStartedRoute = createRoute({ getParentRoute: () => orgRoute, path: 'get-started', component: GetStartedPage })
const orgAgentsRoute = createRoute({ getParentRoute: () => orgRoute, path: 'agents', component: AgentsPage })
const orgAgentDetailRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: 'agents/$agentId',
  component: AgentDetailPage,
})
const orgRequestsRoute = createRoute({ getParentRoute: () => orgRoute, path: 'requests', component: RequestsPage })
const orgMembersRoute = createRoute({ getParentRoute: () => orgRoute, path: 'members', component: MembersPage })
const orgSettingsRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: 'settings',
  component: () => <PlaceholderPage title="Organization settings" />,
})

// Project / branch scope ----------------------------------------------------
const projectRoute = createRoute({ getParentRoute: () => orgRoute, path: 'projects/$projectId/branches/$branch' })
const projectIndexRoute = createRoute({ getParentRoute: () => projectRoute, path: '/', component: OverviewPage })
// "Database" is a section with two subtabs: the data viewer (default/index) and the connection
// details. The parent route has no component, so it renders its active child via <Outlet/>.
const projectDatabaseRoute = createRoute({ getParentRoute: () => projectRoute, path: 'database' })
const projectDatabaseDataRoute = createRoute({ getParentRoute: () => projectDatabaseRoute, path: '/', component: DataPage })
const projectDatabaseConnectionRoute = createRoute({
  getParentRoute: () => projectDatabaseRoute,
  path: 'connection',
  component: DatabasePage,
})
const projectActivityRoute = createRoute({ getParentRoute: () => projectRoute, path: 'activity', component: ActivityPage })
const projectSettingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'settings',
  component: BranchSettingsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  acceptInviteRoute,
  orgRoute.addChildren([
    orgIndexRoute,
    orgGetStartedRoute,
    orgAgentsRoute,
    orgAgentDetailRoute,
    orgRequestsRoute,
    orgMembersRoute,
    orgSettingsRoute,
    projectRoute.addChildren([
      projectIndexRoute,
      projectDatabaseRoute.addChildren([projectDatabaseDataRoute, projectDatabaseConnectionRoute]),
      projectActivityRoute,
      projectSettingsRoute,
    ]),
  ]),
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
