import { Copy } from '@walnut/icons'
import { Button, Dialog, Input } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
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
  const [copied, setCopied] = useState(false)

  function close() {
    setName('')
    setCreated(null)
    setCopied(false)
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

  function copyKey() {
    if (created === null) {
      return
    }
    void navigator.clipboard.writeText(created.apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open={open} onClose={close} title={created === null ? 'New agent' : 'Agent created'}>
      {created === null ? (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-xs text-neutral-500">
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
          <p className="text-xs text-neutral-500">
            The agent joins this organization with no access. It requests scopes on a project, and
            you approve them in Requests.
          </p>
          {create.error !== null ? <p className="text-xs text-red-400">{create.error.message}</p> : null}
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
          <p className="text-sm text-neutral-300">
            <span className="font-medium text-neutral-100">{created.name}</span> is ready. Copy its API key now — it
            won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-xs text-amber-200">
              {created.apiKey}
            </code>
            <Button variant="ghost" onClick={copyKey}>
              <Copy size={15} />
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="flex justify-end pt-1">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
