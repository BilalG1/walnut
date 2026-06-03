import { Link } from '@tanstack/react-router'
import { Inbox, KeyRound, LayoutGrid, Settings, Users } from '@walnut/icons'
import { cn } from '@walnut/ui'
import { useOrgRequests } from '../../data/queries.ts'

const BASE =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-walnut-500/50'
const INACTIVE = cn(BASE, 'text-muted hover:bg-hover')
const ACTIVE = cn(BASE, 'bg-walnut-500/10 text-accent')

export function OrgSidebar({ orgId }: { orgId: string }) {
  // Surface pending scope requests right on the nav so an approval the agent is waiting on
  // is visible from anywhere in the org — this is also the cue the onboarding flow points to.
  const pending = useOrgRequests(orgId, 'pending')
  const pendingCount = pending.data?.length ?? 0
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
          {pendingCount > 0 ? (
            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-walnut-500 px-1.5 text-[11px] font-medium tabular-nums text-white">
              {pendingCount}
            </span>
          ) : null}
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
