import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, KeyRound, Trash } from '@walnut/icons'
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { ApiKeyReveal } from '../../components/ApiKeyReveal.tsx'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useAgent, useDeleteAgent, useRevokeGrant, useRevokeScope, useRotateAgentKey } from '../../data/queries.ts'
import { expiresLabel, scopeDescription, scopeLabel, timeAgo } from '../../lib/format.ts'
import { scopeTone } from '../../lib/tones.ts'

/** A single agent's management page: its live access (revoke a scope or a whole grant), plus
 * key rotation and deletion. Reached from the org agent roster. */
export function AgentDetailPage() {
  const { orgId, agentId } = useParams({ strict: false }) as { orgId?: string; agentId?: string }
  if (orgId === undefined || agentId === undefined) {
    return null
  }
  return <AgentDetailView orgId={orgId} agentId={agentId} />
}

type AgentGrant = NonNullable<ReturnType<typeof useAgent>['data']>['grants'][number]

function AgentDetailView({ orgId, agentId }: { orgId: string; agentId: string }) {
  const navigate = useNavigate()
  const { data: agent, isPending, error } = useAgent(agentId)
  const revokeScope = useRevokeScope(orgId, agentId)
  const revokeGrant = useRevokeGrant(orgId, agentId)
  const rotateKey = useRotateAgentKey(orgId)
  const deleteAgent = useDeleteAgent(orgId)

  const [revokeAll, setRevokeAll] = useState<AgentGrant | null>(null)
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const busy = revokeScope.isPending || revokeGrant.isPending

  function confirmRevokeAll() {
    if (revokeAll === null) {
      return
    }
    revokeGrant.mutate(revokeAll.id, { onSuccess: () => setRevokeAll(null) })
  }

  function rotate() {
    rotateKey.mutate(agentId, { onSuccess: (data) => setRotatedKey(data.apiKey) })
  }

  function confirmDelete() {
    deleteAgent.mutate(agentId, {
      onSuccess: () => void navigate({ to: '/orgs/$orgId/agents', params: { orgId } }),
    })
  }

  return (
    <PageContainer>
      <Link
        to="/orgs/$orgId/agents"
        params={{ orgId }}
        className="inline-flex items-center gap-1.5 text-sm text-subtle hover:text-fg"
      >
        <ArrowLeft size={14} />
        Agents
      </Link>

      {isPending ? (
        <Spinner />
      ) : error !== null ? (
        <p className="mt-6 text-sm text-danger">{error.message}</p>
      ) : agent === undefined ? null : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <Avatar label={agent.name} size={36} gradient="from-sky-500 to-indigo-600" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
                <span className="font-mono">{agent.keyPrefix}</span>
                <span>·</span>
                <span>created {timeAgo(agent.createdAt)}</span>
              </div>
            </div>
          </div>

          <h2 className="mt-8 text-sm font-semibold">Access</h2>
          <p className="mt-1 text-sm text-subtle">
            The live scopes this agent holds, by resource. Revoke a single scope or all access on a resource — it takes
            effect on the agent's next query.
          </p>

          <div className="mt-3 space-y-3">
            {agent.grants.length === 0 ? (
              <EmptyState
                title="No access yet"
                hint="This agent has no live grants. When it requests access, approve it under Requests."
              />
            ) : (
              agent.grants.map((grant) => (
                <Card key={grant.id} className="p-4">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{grant.resourceType}</Badge>
                    <span className="font-medium">{grant.resourceName ?? grant.resourceId}</span>
                    <Button
                      variant="danger"
                      size="sm"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() => setRevokeAll(grant)}
                    >
                      Revoke all
                    </Button>
                  </div>
                  <ul className="mt-3 divide-y divide-line">
                    {grant.scopes.map((s) => {
                      const expiry = expiresLabel(s.expiresAt)
                      const revokingThis =
                        revokeScope.isPending &&
                        revokeScope.variables?.grantId === grant.id &&
                        revokeScope.variables?.scope === s.scope
                      return (
                        <li key={s.scope} className="flex items-center gap-3 py-2.5">
                          <Badge tone={scopeTone(s.scope)} mono className="shrink-0">
                            {scopeLabel(s.scope)}
                          </Badge>
                          <div className="min-w-0">
                            <div className="text-sm text-fg-secondary">{scopeDescription(s.scope)}</div>
                            {expiry !== null ? <div className="text-xs text-subtle">{expiry}</div> : null}
                          </div>
                          <Button
                            variant="subtle"
                            size="sm"
                            className="ml-auto shrink-0"
                            disabled={busy}
                            title={`Revoke ${scopeLabel(s.scope)} (${s.scope})`}
                            onClick={() => revokeScope.mutate({ grantId: grant.id, scope: s.scope })}
                          >
                            {revokingThis ? 'Revoking…' : 'Revoke'}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                  {revokeScope.error !== null && revokeScope.variables?.grantId === grant.id ? (
                    <p className="mt-2 text-xs text-danger">{revokeScope.error.message}</p>
                  ) : null}
                </Card>
              ))
            )}
          </div>

          <Card className="mt-8 border-red-500/20 p-4">
            <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-3">
                <Button variant="ghost" disabled={rotateKey.isPending} onClick={rotate}>
                  <KeyRound size={14} />
                  {rotateKey.isPending ? 'Rotating…' : 'Rotate key'}
                </Button>
                <span className="text-xs text-subtle">Issues a new key and invalidates the current one.</span>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="danger" disabled={deleteAgent.isPending} onClick={() => setDeleteOpen(true)}>
                  <Trash size={14} />
                  Delete agent
                </Button>
                <span className="text-xs text-subtle">Removes the agent and all of its grants.</span>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Revoke-all confirmation */}
      <Dialog
        open={revokeAll !== null}
        onClose={() => {
          setRevokeAll(null)
          revokeGrant.reset()
        }}
        title="Revoke all access?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRevokeAll(null)
                revokeGrant.reset()
              }}
              disabled={revokeGrant.isPending}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRevokeAll} disabled={revokeGrant.isPending}>
              {revokeGrant.isPending ? 'Revoking…' : 'Revoke all'}
            </Button>
          </>
        }
      >
        <p>
          Revoke every scope this agent holds on{' '}
          <span className="font-medium text-fg">{revokeAll?.resourceName ?? revokeAll?.resourceId}</span>. Its next query
          there will be denied until access is granted again.
        </p>
        {revokeGrant.error !== null ? <p className="mt-2 text-xs text-danger">{revokeGrant.error.message}</p> : null}
      </Dialog>

      {/* Rotated-key reveal */}
      <Dialog open={rotatedKey !== null} onClose={() => setRotatedKey(null)} title="New API key">
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">Copy this key now — it won&apos;t be shown again.</p>
          {rotatedKey !== null ? <ApiKeyReveal apiKey={rotatedKey} /> : null}
          <div className="flex justify-end pt-1">
            <Button onClick={() => setRotatedKey(null)}>Done</Button>
          </div>
        </div>
      </Dialog>

      {/* Delete-agent confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
          deleteAgent.reset()
        }}
        title="Delete agent?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteOpen(false)
                deleteAgent.reset()
              }}
              disabled={deleteAgent.isPending}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteAgent.isPending}>
              {deleteAgent.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          This permanently deletes <span className="font-medium text-fg">{agent?.name}</span> and all of its grants. Its
          API key stops working immediately.
        </p>
        {deleteAgent.error !== null ? <p className="mt-2 text-xs text-danger">{deleteAgent.error.message}</p> : null}
      </Dialog>
    </PageContainer>
  )
}
