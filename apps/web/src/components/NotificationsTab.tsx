import type { ProjectSummary, ScopeRequestView } from '@walnut/api/types'
import { useState } from 'react'
import { api } from '../api.ts'
import { timeAgo } from '../lib/format.ts'
import { ScopeBadges } from './ScopeBadges.tsx'
import { Button, Card, EmptyState, Spinner, StatusPill } from './ui.tsx'

interface Props {
  requests: ScopeRequestView[]
  projects: ProjectSummary[]
  loading: boolean
  error: string | null
  onResolved: () => Promise<void>
}

export function NotificationsTab({ requests, projects, loading, error, onResolved }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  function projectName(id: string): string {
    return projects.find((p) => p.id === id)?.name ?? id.slice(0, 8)
  }

  const visible = showResolved ? requests : requests.filter((r) => r.status === 'pending')

  async function resolve(id: string, decision: 'approve' | 'deny'): Promise<void> {
    setBusyId(id)
    if (decision === 'approve') {
      await api.api['scope-requests']({ id }).approve.post()
    } else {
      await api.api['scope-requests']({ id }).deny.post()
    }
    await onResolved()
    setBusyId(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200">Scope requests</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Approve or deny the access agents ask for. Approving adds the scopes to the agent.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      {error !== null && <p className="text-xs text-red-400">{error}</p>}
      {loading && requests.length === 0 ? (
        <Spinner label="Loading requests…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={showResolved ? 'No scope requests' : 'No pending requests'}
          hint="When an agent requests a scope it shows up here for approval."
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((request) => (
            <li key={request.id}>
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-neutral-200">
                      Agent <code className="font-mono text-xs text-neutral-400">{request.agentId.slice(0, 8)}</code> in{' '}
                      <span className="text-neutral-300">{projectName(request.projectId)}</span>
                    </span>
                    <StatusPill status={request.status} />
                  </div>
                  <div className="mt-1.5">
                    <ScopeBadges scopes={request.scopes} />
                  </div>
                  {request.reason !== null && (
                    <p className="mt-1 truncate text-xs text-neutral-500">“{request.reason}”</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-600">requested {timeAgo(request.createdAt)}</p>
                </div>
                {request.status === 'pending' && (
                  <div className="flex shrink-0 gap-2">
                    <Button disabled={busyId === request.id} onClick={() => void resolve(request.id, 'approve')}>
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busyId === request.id}
                      onClick={() => void resolve(request.id, 'deny')}
                    >
                      Deny
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
