import { Button, Dialog, Input } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
import { useCreateProject } from '../../data/queries.ts'

/** Create a project in the current org. Each project provisions a dedicated Postgres
 * database with an inert `main` branch; the dialog closes once it's created. */
export function CreateProjectDialog({
  orgId,
  open,
  onClose,
}: {
  orgId: string
  open: boolean
  onClose: () => void
}) {
  const create = useCreateProject(orgId)
  const [name, setName] = useState('')

  function close() {
    setName('')
    create.reset()
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '' || create.isPending) {
      return
    }
    create.mutate(trimmed, { onSuccess: () => close() })
  }

  return (
    <Dialog open={open} onClose={close} title="New project">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="project-name" className="mb-1 block text-xs text-subtle">
            Name
          </label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="e.g. analytics"
            autoFocus
          />
        </div>
        <p className="text-xs text-subtle">
          Each project gets a dedicated Postgres database with an inert{' '}
          <span className="font-mono">main</span> branch.
        </p>
        {create.error !== null ? <p className="text-xs text-danger">{create.error.message}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || name.trim() === ''}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
