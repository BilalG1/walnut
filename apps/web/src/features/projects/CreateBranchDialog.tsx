import { useNavigate } from '@tanstack/react-router'
import { Button, Dialog, Input } from '@walnut/ui'
import { useEffect, useState, type FormEvent } from 'react'
import { useBranches, useCreateBranch } from '../../data/queries.ts'

/** Create a branch of a project: an instant copy-on-write clone of a source branch (defaulting
 * to the one in view) with its own database and scoped roles. Navigates to the new branch on
 * success. */
export function CreateBranchDialog({
  orgId,
  projectId,
  fromBranch,
  open,
  onClose,
}: {
  orgId: string
  projectId: string
  fromBranch: string
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateBranch(projectId)
  const { data: branches } = useBranches(projectId)
  const [name, setName] = useState('')
  const [from, setFrom] = useState(fromBranch)

  // This dialog lives in the persistent topbar selector, so it stays mounted across branch
  // navigation — re-sync the default source to the in-view branch each time it opens.
  useEffect(() => {
    if (open) {
      setFrom(fromBranch)
    }
  }, [open, fromBranch])

  function close() {
    setName('')
    setFrom(fromBranch)
    create.reset()
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '' || create.isPending) {
      return
    }
    create.mutate(
      { name: trimmed, from },
      {
        onSuccess: (branch) => {
          close()
          void navigate({
            to: '/orgs/$orgId/projects/$projectId/branches/$branch',
            params: { orgId, projectId, branch: branch.name },
          })
        },
      },
    )
  }

  return (
    <Dialog open={open} onClose={close} title="New branch">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="branch-name" className="mb-1 block text-xs text-subtle">
            Name
          </label>
          <Input
            id="branch-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="e.g. feature-x"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="branch-from" className="mb-1 block text-xs text-subtle">
            Branch from
          </label>
          <select
            id="branch-from"
            value={from}
            onChange={(event) => setFrom(event.currentTarget.value)}
            className="w-full rounded-md border border-line bg-sunken px-3 py-2 font-mono text-sm text-fg-secondary outline-none focus-visible:ring-2 focus-visible:ring-walnut-500/50"
          >
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
                {b.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-subtle">
          A branch is an instant copy-on-write clone of its source database, with its own scoped roles.
        </p>
        {create.error !== null ? <p className="text-xs text-danger">{create.error.message}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || name.trim() === ''}>
            {create.isPending ? 'Creating…' : 'Create branch'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
