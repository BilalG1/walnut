import { useNavigate } from '@tanstack/react-router'
import { GitBranch } from '@walnut/icons'
import { Badge, Button, Card, Dialog } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useBranches, useDeleteBranch, useProject } from '../../data/queries.ts'
import { statusTone } from '../../lib/tones.ts'

/** Branch-scoped settings. Project-level concerns (the branch roster, deleting the project) live
 * at org scope — branches are listed/created from the top-bar branch menu, and a project is deleted
 * from its card on the org's Projects page. Here we only manage the branch in view. */
export function BranchSettingsPage() {
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
  const delBranch = useDeleteBranch(projectId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const current = branches?.find((b) => b.name === branch)
  const isDefault = current?.isDefault === true

  function closeConfirm() {
    setConfirmOpen(false)
    delBranch.reset()
  }

  function confirmDelete() {
    delBranch.mutate(branch, {
      onSuccess: () => {
        setConfirmOpen(false)
        // We just deleted the branch in view — fall back to the project's default branch.
        const fallback = branches?.find((b) => b.isDefault)?.name ?? 'main'
        void navigate({
          to: '/orgs/$orgId/projects/$projectId/branches/$branch',
          params: { orgId, projectId, branch: fallback },
        })
      },
    })
  }

  return (
    <PageContainer>
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Branch settings</h1>
        <Badge tone="neutral">
          <GitBranch size={12} />
          {branch}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-subtle">
        Settings for the <span className="font-mono">{branch}</span> branch of {project?.name ?? 'this project'}. Switch
        or create branches from the branch menu in the top bar.
      </p>

      <Card className="mt-6 p-4">
        <h2 className="text-sm font-semibold">Branch</h2>
        <div className="mt-3 flex items-center gap-2.5 text-sm">
          <GitBranch size={14} className="text-muted" />
          <span className="font-mono">{branch}</span>
          {isDefault ? <span className="text-[10px] text-subtle">default</span> : null}
          {current !== undefined ? (
            <Badge tone={statusTone(current.status)} className="ml-1">
              {current.status}
            </Badge>
          ) : null}
        </div>
      </Card>

      <Card className="mt-6 border-red-500/20 p-4">
        <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
        {current === undefined ? (
          // Wait for the branch list before offering a destructive action, so the default
          // branch never briefly shows a live "Delete this branch" button.
          <p className="mt-1 text-sm text-muted">Loading branch…</p>
        ) : isDefault ? (
          <p className="mt-1 text-sm text-muted">
            This is the project's default branch, so it can't be deleted. Delete the project from the Projects page to
            tear it down.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              Deleting this branch permanently destroys its database. This cannot be undone.
            </p>
            <Button variant="danger" className="mt-3" onClick={() => setConfirmOpen(true)}>
              Delete this branch
            </Button>
          </>
        )}
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        title="Delete branch?"
        footer={
          <>
            <Button variant="ghost" onClick={closeConfirm} disabled={delBranch.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={delBranch.isPending}>
              {delBranch.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          This permanently destroys the <span className="font-mono text-fg">{branch}</span> branch and its database.
        </p>
        {delBranch.error !== null ? <p className="mt-2 text-xs text-danger">{delBranch.error.message}</p> : null}
      </Dialog>
    </PageContainer>
  )
}
