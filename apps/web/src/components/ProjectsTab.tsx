import type { ProjectSummary } from '@walnut/api/types'
import { useState } from 'react'
import { api } from '../api.ts'
import { readErrorBody } from '../lib/errors.ts'
import { timeAgo } from '../lib/format.ts'
import { Button, Card, EmptyState, Spinner, StatusPill, TextInput } from './ui.tsx'

interface Props {
  projects: ProjectSummary[]
  loading: boolean
  error: string | null
  onChange: () => Promise<void>
}

export function ProjectsTab({ projects, loading, error, onChange }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function create(): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }
    setBusy(true)
    setFormError(null)
    const res = await api.api.projects.post({ name: trimmed })
    if (res.data === null) {
      setFormError(readErrorBody(res.error?.value).message)
    } else {
      setName('')
      await onChange()
    }
    setBusy(false)
  }

  async function remove(id: string): Promise<void> {
    setBusy(true)
    await api.api.projects({ id }).delete()
    await onChange()
    setBusy(false)
  }

  async function copyConnection(id: string): Promise<void> {
    const res = await api.api.projects({ id }).get()
    const uri = res.data?.connectionUri
    if (uri !== undefined && uri !== null) {
      await navigator.clipboard.writeText(uri)
      setCopiedId(id)
      globalThis.setTimeout(() => setCopiedId(null), 1500)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-neutral-200">Provision a database</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Each project gets its own serverless Postgres. Agents query it through scoped access.
        </p>
        <div className="mt-3 flex gap-2">
          <TextInput
            value={name}
            placeholder="project name, e.g. analytics"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void create()
              }
            }}
            className="flex-1"
          />
          <Button onClick={() => void create()} disabled={busy || name.trim().length === 0}>
            Create project
          </Button>
        </div>
        {formError !== null && <p className="mt-2 text-xs text-red-400">{formError}</p>}
      </Card>

      {error !== null && <p className="text-xs text-red-400">{error}</p>}
      {loading && projects.length === 0 ? (
        <Spinner label="Loading projects…" />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" hint="Create one above to provision a Postgres database." />
      ) : (
        <ul className="space-y-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-neutral-100">{project.name}</span>
                    <StatusPill status={project.status} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {project.provider}
                    {project.region !== null ? ` · ${project.region}` : ''} · created {timeAgo(project.createdAt)}
                  </p>
                  {project.error !== null && <p className="mt-1 text-xs text-red-400">{project.error}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {project.status === 'active' && (
                    <Button variant="ghost" onClick={() => void copyConnection(project.id)}>
                      {copiedId === project.id ? 'Copied!' : 'Copy DB URL'}
                    </Button>
                  )}
                  <Button variant="danger" disabled={busy} onClick={() => void remove(project.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
