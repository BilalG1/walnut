import { useNavigate } from '@tanstack/react-router'
import { GitBranch, Plus, Trash } from '@walnut/icons'
import { Badge, Button, Card, Dialog } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useBranches, useDeleteBranch, useDeleteProject, useProject } from '../../data/queries.ts'
import { statusTone } from '../../lib/tones.ts'
import { CreateBranchDialog } from './CreateBranchDialog.tsx'

export function ProjectSettingsPage() {
  const { orgId, projectId, branch } = useScope()
  if (orgId === undefined || projectId === undefined) {
    return null
  }
  return <SettingsView orgId={orgId} projectId={projectId} branch={branch ?? 'main'} />
}

function SettingsView({ orgId, projectId, branch }: { orgId: string; projectId: string; branch: string }) {
  const navigate = useNavigate()
  const { data: project } = useProject(projectId)
  const { data: branches } = useBranches(projectId)
  const del = useDeleteProject(orgId)
  const delBranch = useDeleteBranch(projectId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [branchToDelete, setBranchToDelete] = useState<string | null>(null)

  function confirmDelete() {
    del.mutate(projectId, {
      onSuccess: () => {
        setConfirmOpen(false)
        void navigate({ to: '/orgs/$orgId', params: { orgId } })
      },
    })
  }

  function confirmDeleteBranch() {
    if (branchToDelete === null) {
      return
    }
    const target = branchToDelete
    delBranch.mutate(target, {
      onSuccess: () => {
        setBranchToDelete(null)
        // If we just deleted the branch in view, fall back to the default branch.
        if (target === branch) {
          const fallback = branches?.find((b) => b.isDefault)?.name ?? 'main'
          void navigate({
            to: '/orgs/$orgId/projects/$projectId/branches/$branch/settings',
            params: { orgId, projectId, branch: fallback },
          })
        }
      },
    })
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-subtle">Branches and settings for {project?.name ?? 'this project'}.</p>

      <Card className="mt-6 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Branches</h2>
          <Button variant="ghost" onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New branch
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Each branch is an isolated copy-on-write database. The default branch can't be deleted.
        </p>
        <div className="mt-3 divide-y divide-line">
          {(branches ?? []).map((b) => (
            <div key={b.id} className="flex items-center gap-2.5 py-2 text-sm">
              <GitBranch size={14} className="text-muted" />
              <span className="font-mono">{b.name}</span>
              {b.isDefault ? <span className="text-[10px] text-subtle">default</span> : null}
              <Badge tone={statusTone(b.status)} className="ml-1">
                {b.status}
              </Badge>
              <span className="flex-1" />
              {b.isDefault ? null : (
                <Button variant="ghost" onClick={() => setBranchToDelete(b.name)} aria-label={`Delete branch ${b.name}`}>
                  <Trash size={14} className="text-danger" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 border-red-500/20 p-4">
        <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">
          Deleting a project tears down all its branch databases and removes its agents. This cannot be undone.
        </p>
        <Button variant="danger" className="mt-3" onClick={() => setConfirmOpen(true)}>
          Delete project
        </Button>
      </Card>

      <CreateBranchDialog
        orgId={orgId}
        projectId={projectId}
        fromBranch={branch}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <Dialog
        open={branchToDelete !== null}
        onClose={() => setBranchToDelete(null)}
        title="Delete branch?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBranchToDelete(null)} disabled={delBranch.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteBranch} disabled={delBranch.isPending}>
              {delBranch.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          This permanently destroys the <span className="font-mono text-fg">{branchToDelete}</span> branch and its
          database.
        </p>
        {delBranch.error !== null ? <p className="mt-2 text-xs text-danger">{delBranch.error.message}</p> : null}
      </Dialog>

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
          This permanently destroys <span className="font-medium text-fg">{project?.name ?? 'this project'}</span>, all
          its branch databases, and all its agents.
        </p>
        {del.error !== null ? <p className="mt-2 text-xs text-danger">{del.error.message}</p> : null}
      </Dialog>
    </PageContainer>
  )
}
