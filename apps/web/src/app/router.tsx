import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppLayout } from '../components/layout/AppLayout.tsx'
import { keys } from '../data/keys.ts'
import { fetchOrganizations } from '../data/queries.ts'
import { PlaceholderPage } from '../features/PlaceholderPage.tsx'
import { AgentsPage } from '../features/orgs/AgentsPage.tsx'
import { ProjectsPage } from '../features/orgs/ProjectsPage.tsx'
import { RequestsPage } from '../features/orgs/RequestsPage.tsx'
import { OverviewPage } from '../features/projects/OverviewPage.tsx'
import { queryClient } from './queryClient.ts'

const rootRoute = createRootRoute({ component: AppLayout })

/** Landing: send the user to their personal org (or first org) home. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async () => {
    const orgs = await queryClient.ensureQueryData({ queryKey: keys.orgs(), queryFn: fetchOrganizations })
    const target = orgs.find((o) => o.isPersonal) ?? orgs[0]
    if (target !== undefined) {
      throw redirect({ to: '/orgs/$orgId', params: { orgId: target.id } })
    }
  },
  component: () => <div className="p-8 text-sm text-neutral-500">You don&apos;t belong to any organization yet.</div>,
})

// Org scope -----------------------------------------------------------------
const orgRoute = createRoute({ getParentRoute: () => rootRoute, path: 'orgs/$orgId' })
const orgIndexRoute = createRoute({ getParentRoute: () => orgRoute, path: '/', component: ProjectsPage })
const orgAgentsRoute = createRoute({ getParentRoute: () => orgRoute, path: 'agents', component: AgentsPage })
const orgRequestsRoute = createRoute({ getParentRoute: () => orgRoute, path: 'requests', component: RequestsPage })
const orgMembersRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: 'members',
  component: () => <PlaceholderPage title="Members" />,
})
const orgSettingsRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: 'settings',
  component: () => <PlaceholderPage title="Organization settings" />,
})

// Project / branch scope ----------------------------------------------------
const projectRoute = createRoute({ getParentRoute: () => orgRoute, path: 'projects/$projectId/branches/$branch' })
const projectIndexRoute = createRoute({ getParentRoute: () => projectRoute, path: '/', component: OverviewPage })
const projectDatabaseRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'database',
  component: () => <PlaceholderPage title="Database" />,
})
const projectActivityRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'activity',
  component: () => <PlaceholderPage title="Activity" />,
})
const projectSettingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'settings',
  component: () => <PlaceholderPage title="Branch settings" />,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  orgRoute.addChildren([
    orgIndexRoute,
    orgAgentsRoute,
    orgRequestsRoute,
    orgMembersRoute,
    orgSettingsRoute,
    projectRoute.addChildren([projectIndexRoute, projectDatabaseRoute, projectActivityRoute, projectSettingsRoute]),
  ]),
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
