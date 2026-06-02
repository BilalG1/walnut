import { Badge, Button, Card, EmptyState, Spinner } from '@walnut/ui'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useOrgAgents, useOrgProjects, useOrgRequests, useResolveRequest } from '../../data/queries.ts'
import { resourceTargetLabel, scopeLabel, timeAgo } from '../../lib/format.ts'
import { scopeTone } from '../../lib/tones.ts'

const HIGH_IMPACT = new Set(['db:delete', 'db:ddl'])

/** Approval inbox: pending scope requests across the org, with approve/deny. */
export function RequestsPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <RequestsView orgId={orgId} />
}

function RequestsView({ orgId }: { orgId: string }) {
  const requests = useOrgRequests(orgId, 'pending')
  const agents = useOrgAgents(orgId)
  const projects = useOrgProjects(orgId)
  const resolve = useResolveRequest(orgId)
  const agentById = new Map((agents.data ?? []).map((a) => [a.id, a]))
  const projectById = new Map((projects.data ?? []).map((p) => [p.id, p.name]))
  const rows = requests.data ?? []

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
      <p className="mt-1 text-sm text-neutral-500">Access agents have asked for, across every project in this organization.</p>

      <div className="mt-6 space-y-3">
        {requests.isPending ? (
          <Spinner />
        ) : requests.error !== null ? (
          <p className="text-sm text-red-400">{requests.error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No pending requests" hint="When an agent asks for new access, it shows up here to approve or deny." />
        ) : (
          rows.map((r) => {
            const agent = agentById.get(r.agentId)
            const highImpact = r.scopes.some((s) => HIGH_IMPACT.has(s))
            return (
              <Card key={r.id} className={highImpact ? 'border-red-500/20 p-4' : 'p-4'}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{agent?.name ?? 'agent'}</span>
                  <span className="text-neutral-500">requests</span>
                  {r.scopes.map((s) => (
                    <Badge key={s} tone={scopeTone(s)} mono>
                      {scopeLabel(s)}
                    </Badge>
                  ))}
                  <span className="text-neutral-500">in</span>
                  <span className="text-neutral-300">
                    {resourceTargetLabel(r.resourceType, projectById.get(r.resourceId) ?? null)}
                  </span>
                  <span className="ml-auto text-xs text-neutral-500">{timeAgo(r.createdAt)}</span>
                </div>
                {r.reason !== null ? <p className="mt-1.5 text-sm text-neutral-300">&ldquo;{r.reason}&rdquo;</p> : null}
                <div className="mt-2.5 flex items-center gap-2">
                  <Button
                    variant="success"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: r.id, decision: 'approve' })}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: r.id, decision: 'deny' })}
                  >
                    Deny
                  </Button>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </PageContainer>
  )
}
