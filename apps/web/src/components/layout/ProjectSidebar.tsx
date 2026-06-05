import { Link } from '@tanstack/react-router'
import { Activity, ArrowLeft, Database, HardDrive, LayoutDashboard, Settings } from '@walnut/icons'
import { cn } from '@walnut/ui'
import { useOrganizations } from '../../data/queries.ts'

const BASE =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-walnut-500/50'
const INACTIVE = cn(BASE, 'text-muted hover:bg-hover')
const ACTIVE = cn(BASE, 'bg-walnut-500/10 text-accent')

export function ProjectSidebar({ orgId, projectId, branch }: { orgId: string; projectId: string; branch: string }) {
  const { data: orgs } = useOrganizations()
  const orgName = orgs?.find((o) => o.id === orgId)?.name ?? 'organization'
  const params = { orgId, projectId, branch }

  return (
    <aside className="w-56 shrink-0 border-r border-line p-3">
      <Link
        to="/orgs/$orgId"
        params={{ orgId }}
        className="mb-2 flex items-center gap-1.5 px-2 text-[11px] text-subtle hover:text-fg-secondary"
      >
        <ArrowLeft size={13} /> {orgName}
      </Link>
      <nav className="mt-3 space-y-0.5">
        <Link
          to="/orgs/$orgId/projects/$projectId/branches/$branch"
          params={params}
          activeOptions={{ exact: true }}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <LayoutDashboard size={16} /> Overview
        </Link>

        <Link
          to="/orgs/$orgId/projects/$projectId/branches/$branch/database"
          params={params}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <Database size={16} /> Database
        </Link>

        <Link
          to="/orgs/$orgId/projects/$projectId/branches/$branch/storage"
          params={params}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <HardDrive size={16} /> Storage
        </Link>

        <Link
          to="/orgs/$orgId/projects/$projectId/branches/$branch/activity"
          params={params}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <Activity size={16} /> Activity
        </Link>
        <Link
          to="/orgs/$orgId/projects/$projectId/branches/$branch/settings"
          params={params}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <Settings size={16} /> Settings
        </Link>
      </nav>
    </aside>
  )
}
