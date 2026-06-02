import { Link } from '@tanstack/react-router'
import { GitBranch, Plus } from '@walnut/icons'
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useCreateProject, useOrgProjects } from '../../data/queries.ts'
import { statusTone } from '../../lib/tones.ts'

/** Org home: the projects launchpad. Clicking a project enters its `main` branch. */
export function ProjectsPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <ProjectsView orgId={orgId} />
}

function ProjectsView({ orgId }: { orgId: string }) {
  const projects = useOrgProjects(orgId)
  const create = useCreateProject(orgId)
  const [name, setName] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '' || create.isPending) {
      return
    }
    create.mutate(trimmed, { onSuccess: () => setName('') })
  }

  const rows = projects.data ?? []

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Open a project to work on its database — each opens on its <span className="font-mono">main</span> branch.
      </p>

      <form onSubmit={submit} className="mt-5 flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="project name, e.g. analytics"
          className="max-w-xs"
        />
        <Button type="submit" disabled={create.isPending}>
          <Plus size={15} />
          {create.isPending ? 'Creating…' : 'New project'}
        </Button>
      </form>
      {create.error !== null ? <p className="mt-2 text-xs text-red-400">{create.error.message}</p> : null}

      <div className="mt-6">
        {projects.isPending ? (
          <Spinner />
        ) : projects.error !== null ? (
          <p className="text-sm text-red-400">{projects.error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No projects yet" hint="Create your first project above — each one gets its own Postgres database." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => {
              const branch = p.defaultBranch ?? 'main'
              const body = (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="font-medium">{p.name}</span>
                    <Badge tone={statusTone(p.status)} className="ml-auto">
                      {p.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {p.provider}
                    {p.region !== null ? ` · ${p.region}` : ''}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span>{p.agentCount} agents</span>
                    {p.pendingRequestCount > 0 ? (
                      <>
                        <span>·</span>
                        <span className="text-walnut-300">{p.pendingRequestCount} pending</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      <GitBranch size={12} />
                      {branch}
                    </span>
                  </div>
                </>
              )
              return p.status === 'active' ? (
                <Link
                  key={p.id}
                  to="/orgs/$orgId/projects/$projectId/branches/$branch"
                  params={{ orgId, projectId: p.id, branch }}
                  className="block"
                >
                  <Card className="p-4 transition-colors hover:border-walnut-500/50 hover:bg-neutral-900">{body}</Card>
                </Link>
              ) : (
                <Card key={p.id} className="p-4">
                  {body}
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
