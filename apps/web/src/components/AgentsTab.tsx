import type { AgentView, ProjectSummary } from '@walnut/api/types'
import { useState } from 'react'
import { api } from '../api.ts'
import { getAgentKey, saveAgentKey } from '../lib/agentKeys.ts'
import { readErrorBody } from '../lib/errors.ts'
import { timeAgo } from '../lib/format.ts'
import { AgentConsole } from './AgentConsole.tsx'
import { ScopeBadges } from './ScopeBadges.tsx'
import { Button, Card, EmptyState, Spinner, TextInput } from './ui.tsx'

interface Props {
  projects: ProjectSummary[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  agents: AgentView[]
  loading: boolean
  error: string | null
  onAgentsChange: () => Promise<void>
  onScopeRequested: () => void
}

export function AgentsTab({
  projects,
  selectedProjectId,
  onSelectProject,
  agents,
  loading,
  error,
  onAgentsChange,
  onScopeRequested,
}: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<{ agentId: string; key: string } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (projects.length === 0) {
    return <EmptyState title="No projects yet" hint="Create a project first, then add agents to it." />
  }

  async function createAgent(): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || selectedProjectId === null) {
      return
    }
    setBusy(true)
    setFormError(null)
    const res = await api.api.projects({ id: selectedProjectId }).agents.post({ name: trimmed })
    if (res.data === null) {
      setFormError(readErrorBody(res.error?.value).message)
    } else {
      saveAgentKey(globalThis.localStorage, res.data.id, res.data.apiKey)
      setRevealedKey({ agentId: res.data.id, key: res.data.apiKey })
      setExpandedId(res.data.id)
      setName('')
      await onAgentsChange()
    }
    setBusy(false)
  }

  async function removeAgent(id: string): Promise<void> {
    setBusy(true)
    setFormError(null)
    const res = await api.api.agents({ id }).delete()
    if (res.error !== null) {
      setFormError(readErrorBody(res.error.value).message)
    }
    await onAgentsChange()
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-neutral-200">Agents</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Agents start with zero scopes. They request access; you approve it in Notifications.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={selectedProjectId ?? ''}
            aria-label="Select project"
            onChange={(e) => onSelectProject(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-walnut-500"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <TextInput
            value={name}
            aria-label="Agent name"
            placeholder="agent name, e.g. claude-code"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void createAgent()
              }
            }}
            className="flex-1"
          />
          <Button onClick={() => void createAgent()} disabled={busy || name.trim().length === 0}>
            Create agent
          </Button>
        </div>
        {formError !== null && <p className="mt-2 text-xs text-red-400">{formError}</p>}
        {revealedKey !== null && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-medium text-amber-200">
              Save this API key — it&apos;s shown only once (also stored in this browser for the console below):
            </p>
            <code className="mt-1 block break-all font-mono text-xs text-amber-100">{revealedKey.key}</code>
          </div>
        )}
      </Card>

      {error !== null && <p className="text-xs text-red-400">{error}</p>}
      {loading && agents.length === 0 ? (
        <Spinner label="Loading agents…" />
      ) : agents.length === 0 ? (
        <EmptyState title="No agents in this project" hint="Create one above to give an AI agent scoped access." />
      ) : (
        <ul className="space-y-2">
          {agents.map((agent) => {
            const key = getAgentKey(globalThis.localStorage, agent.id)
            const expanded = expandedId === agent.id
            return (
              <li key={agent.id}>
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-neutral-100">{agent.name}</span>
                        <code className="font-mono text-xs text-neutral-500">{agent.keyPrefix}…</code>
                      </div>
                      <div className="mt-1.5">
                        <ScopeBadges scopes={agent.scopes} />
                      </div>
                      <p className="mt-1 text-xs text-neutral-600">created {timeAgo(agent.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setExpandedId(expanded ? null : agent.id)}
                      >
                        {expanded ? 'Hide console' : 'Console'}
                      </Button>
                      <Button variant="danger" disabled={busy} onClick={() => void removeAgent(agent.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-4 border-t border-neutral-800 pt-4">
                      <AgentConsole apiKey={key} onScopeRequested={onScopeRequested} />
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
