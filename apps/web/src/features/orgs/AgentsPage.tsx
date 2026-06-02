import { Plus } from '@walnut/icons'
import { Avatar, Badge, Button, Card, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useOrgAgents, useOrgProjects } from '../../data/queries.ts'
import { scopeLabel, timeAgo } from '../../lib/format.ts'
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
  const projects = useOrgProjects(orgId)
  const [createOpen, setCreateOpen] = useState(false)
  const rows = data ?? []
  const activeProjects = (projects.data ?? [])
    .filter((p) => p.status === 'active')
    .map((p) => ({ id: p.id, name: p.name }))

  return (
    <PageContainer>
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Every agent identity in this organization — grant each one access per project.
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          New agent
        </Button>
      </div>

      <CreateAgentDialog orgId={orgId} projects={activeProjects} open={createOpen} onClose={() => setCreateOpen(false)} />

      <div className="mt-6">
        {isPending ? (
          <Spinner />
        ) : error !== null ? (
          <p className="text-sm text-red-400">{error.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No agents yet.</p>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Access</th>
                  <th className="px-4 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-neutral-900/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar label={a.name} size={28} gradient="from-sky-500 to-indigo-600" />
                        <div>
                          <div className="font-medium">{a.name}</div>
                          <div className="font-mono text-[11px] text-neutral-500">{a.keyPrefix}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{a.projectName}</td>
                    <td className="px-4 py-3">
                      {a.scopes.length === 0 ? (
                        <span className="text-xs text-neutral-500">no scopes</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {a.scopes.map((s) => (
                            <Badge key={s} tone={scopeTone(s)} mono>
                              {scopeLabel(s)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-neutral-500">{timeAgo(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
