import { Link } from '@tanstack/react-router'
import { Inbox, KeyRound, LayoutGrid, Settings, Users } from '@walnut/icons'
import { cn } from '@walnut/ui'

const BASE =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-walnut-500/50'
const INACTIVE = cn(BASE, 'text-muted hover:bg-hover')
const ACTIVE = cn(BASE, 'bg-walnut-500/10 text-accent')

export function OrgSidebar({ orgId }: { orgId: string }) {
  return (
    <aside className="w-56 shrink-0 border-r border-line p-3">
      <nav className="space-y-0.5">
        <Link
          to="/orgs/$orgId"
          params={{ orgId }}
          activeOptions={{ exact: true }}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <LayoutGrid size={16} /> Projects
        </Link>
        <Link to="/orgs/$orgId/agents" params={{ orgId }} activeProps={{ className: ACTIVE }} inactiveProps={{ className: INACTIVE }}>
          <KeyRound size={16} /> Agents
        </Link>
        <Link
          to="/orgs/$orgId/requests"
          params={{ orgId }}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <Inbox size={16} /> Requests
        </Link>
        <Link
          to="/orgs/$orgId/members"
          params={{ orgId }}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <Users size={16} /> Members
        </Link>
        <Link
          to="/orgs/$orgId/settings"
          params={{ orgId }}
          activeProps={{ className: ACTIVE }}
          inactiveProps={{ className: INACTIVE }}
        >
          <Settings size={16} /> Settings
        </Link>
      </nav>
    </aside>
  )
}
