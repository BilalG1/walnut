import { Plus } from '@walnut/icons'
import { Avatar, Badge, Button, Card, EmptyState, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useOrgAgents } from '../../data/queries.ts'
import { expiresLabel, scopeLabel, timeAgo } from '../../lib/format.ts'
import { scopeTone } from '../../lib/tones.ts'
import { CreateAgentDialog } from './CreateAgentDialog.tsx'

/** Org-wide agent roster — the single source of truth for identities in the org. */
export function AgentsPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <AgentsView orgId={orgId} />
}

function AgentsView({ orgId }: { orgId: string }) {
  const { data, isPending, error } = useOrgAgents(orgId)
  const [createOpen, setCreateOpen] = useState(false)
  const rows = data ?? []

  return (
    <PageContainer>
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-subtle">
            Every agent identity in this organization — grant each one access per project.
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          New agent
        </Button>
      </div>

      <CreateAgentDialog orgId={orgId} open={createOpen} onClose={() => setCreateOpen(false)} />

      <div className="mt-6">
        {isPending ? (
          <Spinner />
        ) : error !== null ? (
          <p className="text-sm text-danger">{error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No agents yet" hint="Create an agent to give it scoped, approval-gated access to a project's database." />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-subtle">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Access by project</th>
                  <th className="px-4 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => {
                  const projectGrants = a.grants.filter((g) => g.resourceType === 'project')
                  return (
                    <tr key={a.id} className="hover:bg-hover align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar label={a.name} size={28} gradient="from-sky-500 to-indigo-600" />
                          <div>
                            <div className="font-medium">{a.name}</div>
                            <div className="font-mono text-[11px] text-subtle">{a.keyPrefix}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {projectGrants.length === 0 ? (
                          <span className="text-xs text-subtle">no access</span>
                        ) : (
                          <div className="space-y-1.5">
                            {projectGrants.map((g) => (
                              <div key={g.resourceId} className="flex flex-wrap items-center gap-1.5">
                                <span className="text-muted">{g.projectName ?? g.resourceId}</span>
                                {g.scopes.length === 0 ? (
                                  <span className="text-xs text-faint">no scopes</span>
                                ) : (
                                  g.scopes.map((s) => {
                                    const expiry = expiresLabel(s.expiresAt)
                                    return (
                                      <Badge key={s.scope} tone={scopeTone(s.scope)} mono>
                                        {scopeLabel(s.scope)}
                                        {expiry !== null ? (
                                          <span className="ml-1 font-sans text-[10px] opacity-70">{expiry}</span>
                                        ) : null}
                                      </Badge>
                                    )
                                  })
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-subtle">{timeAgo(a.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
