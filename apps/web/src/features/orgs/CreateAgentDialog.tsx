import { Copy } from '@walnut/icons'
import { Button, Dialog, Input } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
import { useCreateAgent } from '../../data/queries.ts'
import { saveAgentKey } from '../../lib/agentKeys.ts'

export interface ProjectOption {
  id: string
  name: string
}

interface CreatedAgent {
  name: string
  apiKey: string
}

/** Create an org-scoped agent, homed on a chosen (active) project, then reveal its API key
 * exactly once. The agent can later be granted access to other projects in the org. */
export function CreateAgentDialog({
  orgId,
  projects,
  open,
  onClose,
}: {
  orgId: string
  projects: ProjectOption[]
  open: boolean
  onClose: () => void
}) {
  const create = useCreateAgent(orgId)
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [created, setCreated] = useState<CreatedAgent | null>(null)
  const [copied, setCopied] = useState(false)

  const selectedProjectId = projectId !== '' ? projectId : (projects[0]?.id ?? '')

  function close() {
    setName('')
    setProjectId('')
    setCreated(null)
    setCopied(false)
    create.reset()
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '' || selectedProjectId === '' || create.isPending) {
      return
    }
    create.mutate(
      { projectId: selectedProjectId, name: trimmed },
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
          {projects.length === 0 ? (
            <p className="text-sm text-neutral-400">
              No active projects yet — create one first, then add an agent to it.
            </p>
          ) : (
            <>
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
              <div>
                <label htmlFor="agent-project" className="mb-1 block text-xs text-neutral-500">
                  Project
                </label>
                <select
                  id="agent-project"
                  value={selectedProjectId}
                  onChange={(event) => setProjectId(event.currentTarget.value)}
                  className="h-8 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none transition-colors focus:border-walnut-500"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-neutral-500">
                The agent joins this organization with no scopes, homed on this project. It
                requests access — here or to other projects — and you approve it in Requests.
              </p>
            </>
          )}
          {create.error !== null ? <p className="text-xs text-red-400">{create.error.message}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || projects.length === 0}>
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
