import { Badge, type BadgeTone, Card, Spinner } from '@walnut/ui'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useActivity } from '../../data/queries.ts'
import { scopeLabel, timeAgo } from '../../lib/format.ts'
import { scopeTone } from '../../lib/tones.ts'

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  ok: { tone: 'emerald', label: 'ok' },
  denied: { tone: 'red', label: 'denied' },
  error: { tone: 'amber', label: 'error' },
}

/** Branch activity: the audit feed of agent query attempts against this database. */
export function ActivityPage() {
  const { projectId } = useScope()
  if (projectId === undefined) {
    return null
  }
  return <ActivityView projectId={projectId} />
}

function ActivityView({ projectId }: { projectId: string }) {
  const { data, isPending, error } = useActivity(projectId)
  const rows = data ?? []

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="mt-1 text-sm text-neutral-500">Every query agents have run against this database — allowed and denied.</p>

      <div className="mt-6">
        {isPending ? (
          <Spinner />
        ) : error !== null ? (
          <p className="text-sm text-red-400">{error.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No agent queries yet.</p>
        ) : (
          <Card className="divide-y divide-neutral-800/70 overflow-hidden">
            {rows.map((e) => {
              const status = STATUS[e.status] ?? { tone: 'neutral' as BadgeTone, label: e.status }
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="w-28 shrink-0 truncate">{e.agentName}</span>
                  <span className="flex shrink-0 gap-1">
                    {e.requiredScopes.map((s) => (
                      <Badge key={s} tone={scopeTone(s)} mono>
                        {scopeLabel(s)}
                      </Badge>
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-400">{e.sql}</span>
                  <span className="w-16 shrink-0 text-right text-xs text-neutral-500">
                    {e.status === 'ok' ? `${e.rowCount ?? 0} rows` : '—'}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs text-neutral-600">
                    {e.durationMs !== null ? `${e.durationMs}ms` : '—'}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-neutral-500">{timeAgo(e.createdAt)}</span>
                </div>
              )
            })}
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
