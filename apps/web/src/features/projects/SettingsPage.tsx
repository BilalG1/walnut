import { useNavigate } from '@tanstack/react-router'
import { Button, Card, Dialog } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useDeleteProject, useProject } from '../../data/queries.ts'

export function ProjectSettingsPage() {
  const { orgId, projectId } = useScope()
  if (orgId === undefined || projectId === undefined) {
    return null
  }
  return <SettingsView orgId={orgId} projectId={projectId} />
}

function SettingsView({ orgId, projectId }: { orgId: string; projectId: string }) {
  const navigate = useNavigate()
  const { data: project } = useProject(projectId)
  const del = useDeleteProject(orgId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function confirmDelete() {
    del.mutate(projectId, {
      onSuccess: () => {
        setConfirmOpen(false)
        void navigate({ to: '/orgs/$orgId', params: { orgId } })
      },
    })
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-subtle">Branch settings for {project?.name ?? 'this project'}.</p>

      <Card className="mt-6 border-red-500/20 p-4">
        <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">
          Deleting a project tears down its database and removes its agents. This cannot be undone.
        </p>
        <Button variant="danger" className="mt-3" onClick={() => setConfirmOpen(true)}>
          Delete project
        </Button>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete project?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={del.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={del.isPending}>
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          This permanently destroys <span className="font-medium text-fg">{project?.name ?? 'this project'}</span>,
          its database, and all its agents.
        </p>
        {del.error !== null ? <p className="mt-2 text-xs text-danger">{del.error.message}</p> : null}
      </Dialog>
    </PageContainer>
  )
}
