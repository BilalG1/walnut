import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, GitBranch } from '@walnut/icons'
import { Avatar, Menu, MenuItem, MenuLabel } from '@walnut/ui'
import { useBranches, useOrganizations, useOrgProjects } from '../../data/queries.ts'

const ORG_GRADIENT = 'from-indigo-400 to-sky-600'
const TRIGGER = 'gap-2 px-2 py-1.5 text-sm hover:bg-neutral-800/70'

export function OrgSelector({ orgId }: { orgId: string }) {
  const navigate = useNavigate()
  const { data: orgs } = useOrganizations()
  const current = orgs?.find((o) => o.id === orgId)
  return (
    <Menu
      triggerClassName={TRIGGER}
      trigger={
        <>
          <Avatar label={current?.name ?? '?'} gradient={ORG_GRADIENT} />
          <span className="font-medium">{current?.name ?? '…'}</span>
          <ChevronDown size={14} className="text-neutral-500" />
        </>
      }
    >
      <MenuLabel>Organizations</MenuLabel>
      {(orgs ?? []).map((o) => (
        <MenuItem
          key={o.id}
          active={o.id === orgId}
          onSelect={() => void navigate({ to: '/orgs/$orgId', params: { orgId: o.id } })}
        >
          <Avatar label={o.name} size={20} gradient={ORG_GRADIENT} />
          <span className="flex-1 truncate">{o.name}</span>
          {o.isPersonal ? <span className="text-[10px] text-neutral-500">personal</span> : null}
          {o.id === orgId ? <Check size={14} className="text-emerald-400" /> : null}
        </MenuItem>
      ))}
    </Menu>
  )
}

export function ProjectSelector({ orgId, projectId }: { orgId: string; projectId: string }) {
  const navigate = useNavigate()
  const { data: projects } = useOrgProjects(orgId)
  const current = projects?.find((p) => p.id === projectId)
  return (
    <Menu
      triggerClassName={TRIGGER}
      trigger={
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-medium">{current?.name ?? '…'}</span>
          <ChevronDown size={14} className="text-neutral-500" />
        </>
      }
    >
      <MenuLabel>Projects</MenuLabel>
      {(projects ?? []).map((p) => (
        <MenuItem
          key={p.id}
          active={p.id === projectId}
          onSelect={() =>
            void navigate({
              to: '/orgs/$orgId/projects/$projectId/branches/$branch',
              params: { orgId, projectId: p.id, branch: p.defaultBranch ?? 'main' },
            })
          }
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="flex-1 truncate">{p.name}</span>
          {p.id === projectId ? <Check size={14} className="text-emerald-400" /> : null}
        </MenuItem>
      ))}
    </Menu>
  )
}

export function BranchSelector({ orgId, projectId, branch }: { orgId: string; projectId: string; branch: string }) {
  const navigate = useNavigate()
  const { data: branches } = useBranches(projectId)
  return (
    <Menu
      triggerClassName={TRIGGER}
      trigger={
        <>
          <GitBranch size={14} className="text-neutral-400" />
          <span className="font-mono text-sm">{branch}</span>
          <ChevronDown size={14} className="text-neutral-500" />
        </>
      }
    >
      <MenuLabel>Branches · preview</MenuLabel>
      {(branches ?? []).map((b) => (
        <MenuItem
          key={b.id}
          active={b.name === branch}
          onSelect={() =>
            void navigate({
              to: '/orgs/$orgId/projects/$projectId/branches/$branch',
              params: { orgId, projectId, branch: b.name },
            })
          }
        >
          <GitBranch size={14} className="text-neutral-400" />
          <span className="flex-1 truncate font-mono">{b.name}</span>
          {b.isDefault ? <span className="text-[10px] text-neutral-500">default</span> : null}
          {b.name === branch ? <Check size={14} className="text-emerald-400" /> : null}
        </MenuItem>
      ))}
    </Menu>
  )
}
