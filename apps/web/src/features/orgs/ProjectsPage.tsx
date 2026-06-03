import { Link } from '@tanstack/react-router'
import { GitBranch, MoreHorizontal, Plus, Trash } from '@walnut/icons'
import { Badge, Button, Card, Dialog, EmptyState, Menu, MenuItem, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useDeleteProject, useOrgProjects } from '../../data/queries.ts'
import { statusTone } from '../../lib/tones.ts'
import { CreateProjectDialog } from './CreateProjectDialog.tsx'

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
  const del = useDeleteProject(orgId)
  const [createOpen, setCreateOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  const rows = projects.data ?? []

  function closeDeleteDialog() {
    setProjectToDelete(null)
    del.reset()
  }

  function confirmDelete() {
    if (projectToDelete === null) {
      return
    }
    del.mutate(projectToDelete.id, { onSuccess: () => closeDeleteDialog() })
  }

  return (
    <PageContainer>
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-subtle">
            Open a project to work on its database — each opens on its{' '}
            <span className="font-mono">main</span> branch.
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          New project
        </Button>
      </div>

      <CreateProjectDialog orgId={orgId} open={createOpen} onClose={() => setCreateOpen(false)} />

      <Dialog
        open={projectToDelete !== null}
        onClose={closeDeleteDialog}
        title="Delete project?"
        footer={
          <>
            <Button variant="ghost" onClick={closeDeleteDialog} disabled={del.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={del.isPending}>
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          This permanently destroys <span className="font-medium text-fg">{projectToDelete?.name ?? 'this project'}</span>
          , all its branch databases, and all its agents. This cannot be undone.
        </p>
        {del.error !== null ? <p className="mt-2 text-xs text-danger">{del.error.message}</p> : null}
      </Dialog>

      <div className="mt-6">
        {projects.isPending ? (
          <Spinner />
        ) : projects.error !== null ? (
          <p className="text-sm text-danger">{projects.error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No projects yet" hint="Create your first project — each one gets its own Postgres database." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => {
              const branch = p.defaultBranch ?? 'main'
              const body = (
                <>
                  {/* Right padding leaves room for the actions kebab overlaid in the corner. */}
                  <div className="flex items-center gap-2 pr-7">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="font-medium">{p.name}</span>
                    <Badge tone={statusTone(p.status)} className="ml-auto">
                      {p.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-subtle">
                    {p.provider}
                    {p.defaultBranch !== null ? ` · ${p.defaultBranch}` : ''}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-subtle">
                    <span>{p.agentCount} agents</span>
                    {p.pendingRequestCount > 0 ? (
                      <>
                        <span>·</span>
                        <span className="text-accent">{p.pendingRequestCount} pending</span>
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
              return (
                // The actions menu is a sibling of the card link (not nested in the anchor) so it's
                // valid markup and its clicks never trigger card navigation.
                <div key={p.id} className="relative">
                  {p.status === 'active' ? (
                    <Link
                      to="/orgs/$orgId/projects/$projectId/branches/$branch"
                      params={{ orgId, projectId: p.id, branch }}
                      className="block"
                    >
                      <Card className="p-4 transition-colors hover:border-walnut-500/50 hover:bg-hover">{body}</Card>
                    </Link>
                  ) : (
                    <Card className="p-4">{body}</Card>
                  )}
                  <div className="absolute right-2 top-2.5">
                    <Menu
                      align="end"
                      triggerLabel={`Actions for ${p.name}`}
                      triggerClassName="p-1 text-subtle hover:bg-hover hover:text-fg"
                      trigger={<MoreHorizontal size={16} />}
                    >
                      <MenuItem onSelect={() => setProjectToDelete({ id: p.id, name: p.name })}>
                        <Trash size={14} className="text-danger" />
                        <span className="text-danger">Delete project</span>
                      </MenuItem>
                    </Menu>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
