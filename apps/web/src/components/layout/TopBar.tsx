import { Link } from '@tanstack/react-router'
import { Bell, LogOut } from '@walnut/icons'
import { Avatar, Menu, MenuItem, MenuLabel, MenuSeparator } from '@walnut/ui'
import { useScope } from '../../app/useScope.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { Breadcrumb } from './Breadcrumb.tsx'

export function TopBar() {
  const { orgId } = useScope()
  const { user, signOut } = useAuth()
  const label = user?.email ?? user?.name ?? '?'
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-800 bg-neutral-950/80 px-4 backdrop-blur">
      <Breadcrumb />
      <div className="flex-1" />
      {orgId !== undefined ? (
        <Link
          to="/orgs/$orgId/requests"
          params={{ orgId }}
          aria-label="Requests"
          className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800"
        >
          <Bell size={18} />
        </Link>
      ) : null}
      <Menu align="end" triggerLabel="Account menu" triggerClassName="rounded-full" trigger={<Avatar label={label} size={28} />}>
        <MenuLabel>{label}</MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={signOut}>
          <LogOut size={15} className="text-neutral-400" />
          Sign out
        </MenuItem>
      </Menu>
    </header>
  )
}
