import { Link } from '@tanstack/react-router'
import { Bell, LogOut, Moon, Sun } from '@walnut/icons'
import { Avatar, Menu, MenuItem, MenuLabel, MenuSeparator } from '@walnut/ui'
import { useScope } from '../../app/useScope.ts'
import { useTheme } from '../../app/theme.tsx'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { Breadcrumb } from './Breadcrumb.tsx'

export function TopBar() {
  const { orgId } = useScope()
  const { user, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const label = user?.email ?? user?.name ?? '?'
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur">
      <Breadcrumb />
      <div className="flex-1" />
      {orgId !== undefined ? (
        <Link
          to="/orgs/$orgId/requests"
          params={{ orgId }}
          aria-label="Requests"
          className="rounded-lg p-2 text-muted outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-walnut-500/50"
        >
          <Bell size={18} />
        </Link>
      ) : null}
      <Menu
        align="end"
        triggerLabel="Account menu"
        triggerClassName="p-1 transition-colors hover:bg-hover"
        trigger={<Avatar label={label} size={26} />}
      >
        <MenuLabel>{label}</MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={toggleTheme}>
          {theme === 'dark' ? (
            <Sun size={15} className="text-muted" />
          ) : (
            <Moon size={15} className="text-muted" />
          )}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </MenuItem>
        <MenuItem onSelect={signOut}>
          <LogOut size={15} className="text-muted" />
          Sign out
        </MenuItem>
      </Menu>
    </header>
  )
}
