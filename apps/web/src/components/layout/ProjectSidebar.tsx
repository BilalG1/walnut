import { Link } from '@tanstack/react-router'
import { Activity, ArrowLeft, Database, LayoutDashboard, Settings } from '@walnut/icons'
import { cn } from '@walnut/ui'
import { useOrganizations, useOrgProjects } from '../../data/queries.ts'

const BASE =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-walnut-500/50'
const INACTIVE = cn(BASE, 'text-neutral-400 hover:bg-neutral-900')
const ACTIVE = cn(BASE, 'bg-walnut-500/10 text-walnut-200')

export function ProjectSidebar({ orgId, projectId, branch }: { orgId: string; projectId: string; branch: string }) {
  const { data: orgs } = useOrganizations()
  const { data: projects } = useOrgProjects(orgId)
  const orgName = orgs?.find((o) => o.id === orgId)?.name ?? 'organization'
  const projectName = projects?.find((p) => p.id === projectId)?.name ?? 'project'
  const params = { orgId, projectId, branch }
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-800 p-3">
      <Link
        to="/orgs/$orgId"
        params={{ orgId }}
        className="mb-2 flex items-center gap-1.5 px-2 text-[11px] text-neutral-500 hover:text-neutral-300"
      >
        <ArrowLeft size={13} /> {orgName}
      </Link>
      <div className="mb-3 flex items-center gap-2 px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <div className="leading-tight">
          <div className="text-[13px] font-medium">{projectName}</div>
          <div className="font-mono text-[10px] text-neutral-500">{branch}</div>
        </div>
      </div>
      <nav className="space-y-0.5">
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
