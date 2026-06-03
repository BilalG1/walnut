import { Button, Dialog, Input } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
import { ApiKeyReveal } from '../../components/ApiKeyReveal.tsx'
import { useCreateAgent } from '../../data/queries.ts'
import { saveAgentKey } from '../../lib/agentKeys.ts'

interface CreatedAgent {
  name: string
  apiKey: string
}

/** Create an org-scoped agent, then reveal its API key exactly once. The agent is born
 * with no access — the user grants it per-project scopes by approving its requests. */
export function CreateAgentDialog({
  orgId,
  open,
  onClose,
}: {
  orgId: string
  open: boolean
  onClose: () => void
}) {
  const create = useCreateAgent(orgId)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<CreatedAgent | null>(null)

  function close() {
    setName('')
    setCreated(null)
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
      { name: trimmed },
      {
        onSuccess: (agent) => {
          saveAgentKey(localStorage, agent.id, agent.apiKey)
          setCreated({ name: agent.name, apiKey: agent.apiKey })
        },
      },
    )
  }

  return (
    <Dialog open={open} onClose={close} title={created === null ? 'New agent' : 'Agent created'}>
      {created === null ? (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-xs text-subtle">
              Name
            </label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="e.g. claude-code"
              autoFocus
            />
          </div>
          <p className="text-xs text-subtle">
            The agent joins this organization with no access. It requests scopes on a project, and
            you approve them in Requests.
          </p>
          {create.error !== null ? <p className="text-xs text-danger">{create.error.message}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim() === ''}>
              {create.isPending ? 'Creating…' : 'Create agent'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">
            <span className="font-medium text-fg">{created.name}</span> is ready. Copy its API key now — it
            won&apos;t be shown again.
          </p>
          <ApiKeyReveal apiKey={created.apiKey} />
          <div className="flex justify-end pt-1">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
