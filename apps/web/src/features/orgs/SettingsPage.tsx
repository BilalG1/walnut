import { useNavigate } from '@tanstack/react-router'
import { Building, Check, Copy, GitBranch, KeyRound, LayoutGrid, LogOut } from '@walnut/icons'
import { Badge, Button, Card, Dialog, Spinner, cn, type BadgeTone } from '@walnut/ui'
import { useState, type ReactNode } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useLeaveOrganization, useMe, useOrganizations, useOrgUsage } from '../../data/queries.ts'

type Usage = { used: number; limit: number }

/** Tone-code an org role: owner stands out, admin is mid, member is neutral. */
function roleTone(role: string): BadgeTone {
  return role === 'owner' ? 'amber' : role === 'admin' ? 'purple' : 'neutral'
}

/** Absolute, locale-friendly "created on" date (e.g. `Jun 3, 2026`). */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Organization settings: the org's identity (name, type, id, your role), its resource usage
 * against the platform caps, and — for a non-owner member — a way to leave the org. */
export function SettingsPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <SettingsView orgId={orgId} />
}

function SettingsView({ orgId }: { orgId: string }) {
  const navigate = useNavigate()
  const me = useMe()
  const orgs = useOrganizations()
  const usage = useOrgUsage(orgId)
  const leave = useLeaveOrganization(orgId)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const org = orgs.data?.find((o) => o.id === orgId)
  // Only a non-owner member can leave: an owner must hand off or delete instead, and a personal
  // org's sole member is its owner, so this never shows there. Gate on the loaded org so the
  // button never flashes before we know the caller's role.
  const canLeave = org !== undefined && org.role !== 'owner'

  function closeLeave() {
    setConfirmLeave(false)
    leave.reset()
  }

  function confirmLeaveOrg() {
    const myId = me.data?.id
    if (myId === undefined) {
      return
    }
    leave.mutate(myId, {
      onSuccess: () => {
        setConfirmLeave(false)
        // We just dropped our own membership — bounce to the landing route, which redirects to a
        // remaining org (the personal one).
        void navigate({ to: '/' })
      },
    })
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Organization settings</h1>
      <p className="mt-1 text-sm text-subtle">This organization&apos;s identity and resource usage.</p>

      {org === undefined ? (
        <div className="mt-6">
          <Spinner />
        </div>
      ) : (
        <Card className="mt-6 p-4">
          <h2 className="text-sm font-semibold">Organization</h2>
          <div className="mt-3 flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-walnut-500/10 text-accent">
              <Building size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{org.name}</span>
                <Badge tone={org.isPersonal ? 'neutral' : 'walnut'}>{org.isPersonal ? 'Personal' : 'Shared'}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-subtle">Created {formatDate(org.createdAt)}</p>
            </div>
          </div>
          <dl className="mt-4 grid gap-2 border-t border-line pt-4 text-sm">
            <div className="flex items-center gap-3">
              <dt className="w-32 shrink-0 text-subtle">Organization ID</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <code className="truncate rounded bg-sunken px-1.5 py-0.5 font-mono text-xs text-muted">{org.id}</code>
                <CopyButton value={org.id} />
              </dd>
            </div>
            <div className="flex items-center gap-3">
              <dt className="w-32 shrink-0 text-subtle">Your role</dt>
              <dd>
                <Badge tone={roleTone(org.role)}>{org.role}</Badge>
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <Card className="mt-6 p-4">
        <h2 className="text-sm font-semibold">Usage</h2>
        <p className="mt-1 text-xs text-subtle">
          What this organization has provisioned against its limits. These caps protect the shared infrastructure —
          reach one and creating more is blocked until you free some up.
        </p>
        <div className="mt-4">
          {usage.isPending ? (
            <Spinner />
          ) : usage.error !== null ? (
            <p className="text-sm text-danger">{usage.error.message}</p>
          ) : usage.data === undefined ? null : (
            <div className="space-y-4">
              <UsageRow icon={<LayoutGrid size={14} />} label="Projects" usage={usage.data.projects} />
              <UsageRow icon={<GitBranch size={14} />} label="Branches" usage={usage.data.branches} />
              <UsageRow icon={<KeyRound size={14} />} label="Agents" usage={usage.data.agents} />
            </div>
          )}
        </div>
      </Card>

      {canLeave ? (
        <Card className="mt-6 border-red-500/20 p-4">
          <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
          <p className="mt-1 text-sm text-muted">
            Leaving removes your access to all of this organization&apos;s projects. You&apos;ll need a new invite to
            rejoin.
          </p>
          <Button variant="danger" className="mt-3" onClick={() => setConfirmLeave(true)}>
            <LogOut size={15} />
            Leave organization
          </Button>
        </Card>
      ) : null}

      <Dialog
        open={confirmLeave}
        onClose={closeLeave}
        title="Leave organization?"
        footer={
          <>
            <Button variant="ghost" onClick={closeLeave} disabled={leave.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmLeaveOrg} disabled={leave.isPending}>
              {leave.isPending ? 'Leaving…' : 'Leave'}
            </Button>
          </>
        }
      >
        <p>
          Leave <span className="font-medium text-fg">{org?.name}</span>? You lose access to all of its projects
          immediately and need a new invite to come back.
        </p>
        {leave.error !== null ? <p className="mt-2 text-xs text-danger">{leave.error.message}</p> : null}
      </Dialog>
    </PageContainer>
  )
}

/** A labeled usage bar: icon + label, the `used / limit` count, and a fill that tints amber
 * then red as it nears the cap. */
function UsageRow({ icon, label, usage }: { icon: ReactNode; label: string; usage: Usage }) {
  const pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0
  const tone = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-walnut-500'
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{icon}</span>
        <span className="font-medium">{label}</span>
        <span className="ml-auto tabular-nums text-subtle">
          {usage.used} <span className="text-faint">/ {usage.limit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Copy a value (the org id) to the clipboard, flashing a check for a beat. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button variant="subtle" size="sm" onClick={copy} title="Copy organization ID">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
