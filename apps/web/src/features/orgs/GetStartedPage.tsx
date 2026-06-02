import { useNavigate } from '@tanstack/react-router'
import { Bell, Check, ChevronRight, Copy, Database, KeyRound, ShieldCheck } from '@walnut/icons'
import { Avatar, Badge, Button, cn, Input, Spinner } from '@walnut/ui'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useScope } from '../../app/useScope.ts'
import { useCreateAgent, useCreateProject, useOrgRequests, useResolveRequest } from '../../data/queries.ts'
import { saveAgentKey } from '../../lib/agentKeys.ts'

/** Guided first-run flow: create a project, connect an agent via the CLI, then watch the
 * agent's first scope request arrive and approve it. Org-scoped — a project doesn't exist
 * until step 1 completes, so this lives at `/orgs/$orgId/get-started`. */
export function GetStartedPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <GetStartedView orgId={orgId} />
}

const STEPS: { title: string; blurb: string; icon: typeof Database }[] = [
  { title: 'Create your project', blurb: 'A dedicated Postgres database', icon: Database },
  { title: 'Connect your agent', blurb: 'Install the CLI and log in', icon: KeyRound },
  { title: 'Grant access', blurb: 'Approve its first request', icon: ShieldCheck },
]

function GetStartedView({ orgId }: { orgId: string }) {
  const navigate = useNavigate()
  const projectMut = useCreateProject(orgId)
  const agentMut = useCreateAgent(orgId)
  const resolve = useResolveRequest(orgId)

  const [step, setStep] = useState(0)
  const [projectName, setProjectName] = useState('My project')
  const [project, setProject] = useState<{ id: string; name: string } | null>(null)
  const [agentName, setAgentName] = useState('my-agent')
  const [agent, setAgent] = useState<{ id: string; name: string; apiKey: string } | null>(null)
  const [approved, setApproved] = useState(false)
  const [grantedScopes, setGrantedScopes] = useState<string[]>([])

  // Poll for the agent's incoming request only while we're waiting on it.
  const pending = useOrgRequests(orgId, 'pending', { refetchInterval: step === 2 && !approved ? 2000 : false })
  const incoming = agent === null ? null : (pending.data?.find((r) => r.agentId === agent.id) ?? null)

  function submitProject(event: FormEvent) {
    event.preventDefault()
    const name = projectName.trim()
    if (name === '' || projectMut.isPending) {
      return
    }
    projectMut.mutate(name, {
      onSuccess: (created) => {
        setProject({ id: created.id, name: created.name })
        setStep(1)
      },
    })
  }

  function submitAgent(event: FormEvent) {
    event.preventDefault()
    const name = agentName.trim()
    if (name === '' || agentMut.isPending) {
      return
    }
    agentMut.mutate(
      { name },
      {
        onSuccess: (created) => {
          saveAgentKey(localStorage, created.id, created.apiKey)
          setAgent({ id: created.id, name: created.name, apiKey: created.apiKey })
        },
      },
    )
  }

  function approve() {
    if (incoming === null) {
      return
    }
    setGrantedScopes(incoming.scopes)
    resolve.mutate({ id: incoming.id, decision: 'approve' }, { onSuccess: () => setApproved(true) })
  }

  function deny() {
    if (incoming !== null) {
      resolve.mutate({ id: incoming.id, decision: 'deny' })
    }
  }

  function finish() {
    if (project === null) {
      void navigate({ to: '/orgs/$orgId', params: { orgId } })
      return
    }
    void navigate({
      to: '/orgs/$orgId/projects/$projectId/branches/$branch',
      params: { orgId, projectId: project.id, branch: 'main' },
    })
  }

  const promptText = `Use the walnut CLI to connect to my Walnut project "${project?.name ?? 'my project'}" and list every table in its database. If you don't have permission yet, request the access you need with the walnut CLI, then tell me you're waiting on my approval.`

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Walnut</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Give your first agent scoped access to a real database — in three steps.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: '/orgs/$orgId', params: { orgId } })}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-500 outline-none transition-colors hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-walnut-500/50"
        >
          Skip for now
        </button>
      </div>

      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        {/* Stepper rail */}
        <ol className="relative space-y-1">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            const Icon = s.icon
            return (
              <li key={s.title} className="relative">
                {i < STEPS.length - 1 ? (
                  <span
                    className={cn(
                      'absolute left-[15px] top-9 h-[calc(100%-12px)] w-px',
                      done ? 'bg-walnut-500/50' : 'bg-neutral-800',
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => done && setStep(i)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left transition-colors',
                    done ? 'hover:bg-neutral-900/60' : 'cursor-default',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors',
                      done
                        ? 'border-transparent bg-walnut-500 text-white'
                        : active
                          ? 'border-walnut-500 bg-walnut-500/10 text-walnut-300'
                          : 'border-neutral-700 text-neutral-500',
                    )}
                  >
                    {done ? <Check size={16} strokeWidth={2.6} /> : <Icon size={16} />}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-sm font-medium',
                        active ? 'text-neutral-100' : done ? 'text-neutral-300' : 'text-neutral-500',
                      )}
                    >
                      {s.title}
                    </span>
                    <span className={cn('block text-xs', active ? 'text-walnut-400/80' : 'text-neutral-600')}>
                      {s.blurb}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {/* Active panel */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60">
          <div key={step} className="wnut-fade-in p-8">
            {step === 0 ? (
              <section>
                <PanelHeader
                  icon={<Database size={20} />}
                  title="Create your first project"
                  blurb="Every project gets a dedicated Postgres database with an inert main branch."
                />
                <form onSubmit={submitProject} className="mt-6">
                  <label htmlFor="gs-project" className="mb-1.5 block text-xs font-medium tracking-wide text-neutral-400">
                    Project name
                  </label>
                  <Input
                    id="gs-project"
                    value={projectName}
                    onChange={(event) => setProjectName(event.currentTarget.value)}
                    placeholder="My project"
                    autoFocus
                    className="max-w-sm"
                  />
                  {projectMut.error !== null ? (
                    <p className="mt-2 text-xs text-red-400">{projectMut.error.message}</p>
                  ) : null}
                  <div className="mt-6">
                    <Button type="submit" disabled={projectMut.isPending || projectName.trim() === ''}>
                      {projectMut.isPending ? 'Creating…' : 'Create project'}
                      {projectMut.isPending ? null : <ChevronRight size={16} />}
                    </Button>
                  </div>
                </form>
              </section>
            ) : null}

            {step === 1 ? (
              <section>
                <PanelHeader
                  icon={<KeyRound size={20} />}
                  title="Connect your agent"
                  blurb="Create an agent, then install the CLI and log it in. Agents start with zero scopes."
                />
                {agent === null ? (
                  <form onSubmit={submitAgent} className="mt-6">
                    <label htmlFor="gs-agent" className="mb-1.5 block text-xs font-medium tracking-wide text-neutral-400">
                      Agent name
                    </label>
                    <Input
                      id="gs-agent"
                      value={agentName}
                      onChange={(event) => setAgentName(event.currentTarget.value)}
                      placeholder="my-agent"
                      autoFocus
                      className="max-w-sm"
                    />
                    {agentMut.error !== null ? (
                      <p className="mt-2 text-xs text-red-400">{agentMut.error.message}</p>
                    ) : null}
                    <div className="mt-6">
                      <Button type="submit" disabled={agentMut.isPending || agentName.trim() === ''}>
                        {agentMut.isPending ? 'Creating…' : 'Create agent & reveal key'}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-6 space-y-4 wnut-slide-in">
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="mb-2 text-xs font-medium text-amber-200/90">
                        Copy {agent.name}&apos;s API key now — it won&apos;t be shown again.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 font-mono text-xs text-amber-100/90">
                          {agent.apiKey}
                        </code>
                        <CopyButton value={agent.apiKey} />
                      </div>
                    </div>
                    <CommandBlock label="install" command="curl -fsSL https://walnut.sh/install | sh" />
                    <CommandBlock label="log in" command={`walnut login --api-key ${agent.apiKey}`} />
                    <p className="text-xs text-neutral-500">
                      Verify with <span className="font-mono text-neutral-300">walnut whoami</span> — you&apos;ll see{' '}
                      <span className="font-mono text-walnut-300">scopes: []</span>. That&apos;s expected: nothing is
                      granted yet.
                    </p>
                    <div className="pt-1">
                      <Button onClick={() => setStep(2)}>
                        Continue
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            ) : null}

            {step === 2 ? (
              <section>
                <PanelHeader
                  icon={<ShieldCheck size={20} />}
                  title="Grant your agent access"
                  blurb="Hand your agent this prompt. It will hit a wall, ask for access, and you decide."
                />

                {approved ? (
                  <div className="mt-8 text-center wnut-slide-in">
                    <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                      <ShieldCheck size={30} />
                    </div>
                    <h3 className="text-lg font-semibold tracking-tight">You granted your first scope 🎉</h3>
                    <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-400">
                      <span className="text-neutral-200">{agent?.name}</span> now holds{' '}
                      {grantedScopes.map((s) => (
                        <Badge key={s} tone="walnut" mono className="mx-0.5">
                          {s}
                        </Badge>
                      ))}{' '}
                      — enforced by its own Postgres role, not just a checkbox. It can read your database now.
                    </p>
                    <div className="mt-7 flex justify-center gap-2">
                      <Button onClick={finish}>
                        Go to {project?.name ?? 'project'}
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    <div className="rounded-xl border border-walnut-500/30 bg-walnut-500/5 p-4">
                      <p className="text-sm leading-relaxed text-neutral-200">{promptText}</p>
                      <div className="mt-3">
                        <CopyButton value={promptText} label="Copy prompt" variant="bordered" />
                      </div>
                    </div>

                    {incoming === null ? (
                      <div className="rounded-xl border border-dashed border-neutral-800 px-6 py-10 text-center">
                        <div className="relative mx-auto mb-5 h-14 w-14">
                          <span className="absolute inset-0 rounded-full bg-walnut-500/20 wnut-pulse-ring" />
                          <span
                            className="absolute inset-0 rounded-full bg-walnut-500/20 wnut-pulse-ring"
                            style={{ animationDelay: '0.9s' }}
                          />
                          <span className="relative grid h-14 w-14 place-items-center rounded-full border border-walnut-500/40 bg-neutral-950 text-walnut-400">
                            <Bell size={22} />
                          </span>
                        </div>
                        <div className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-200">
                          <Spinner className="h-4 w-4" />
                          Waiting for {agent?.name ?? 'your agent'} to request access…
                        </div>
                        <p className="mx-auto mt-1.5 max-w-sm text-xs text-neutral-500">
                          When it runs <span className="font-mono text-neutral-400">walnut scope request</span>, the
                          request will appear here for your approval.
                        </p>
                      </div>
                    ) : (
                      <div className="wnut-slide-in">
                        <div className="mb-3 flex items-center gap-2 text-sm text-neutral-300">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-walnut-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-walnut-500" />
                          </span>
                          New scope request
                        </div>
                        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                          <div className="flex items-start gap-3">
                            <Avatar label={agent?.name ?? 'agent'} size={36} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-neutral-100">{agent?.name}</span>
                                <span className="text-xs text-neutral-500">
                                  wants to access {project?.name ?? 'your project'}
                                </span>
                              </div>
                              {incoming.reason !== null && incoming.reason !== '' ? (
                                <p className="mt-1 text-sm text-neutral-400">“{incoming.reason}”</p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                {incoming.scopes.map((s) => (
                                  <Badge key={s} tone="walnut" mono>
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                              {resolve.error !== null ? (
                                <p className="mt-2 text-xs text-red-400">{resolve.error.message}</p>
                              ) : null}
                              <div className="mt-4 flex gap-2">
                                <Button variant="success" size="sm" onClick={approve} disabled={resolve.isPending}>
                                  <Check size={15} strokeWidth={2.4} />
                                  {resolve.isPending ? 'Approving…' : 'Approve'}
                                </Button>
                                <Button variant="danger" size="sm" onClick={deny} disabled={resolve.isPending}>
                                  Deny
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ icon, title, blurb }: { icon: ReactNode; title: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-walnut-400">
        {icon}
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-neutral-400">{blurb}</p>
      </div>
    </div>
  )
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <span className="font-mono text-[11px] text-neutral-500">{label}</span>
        <CopyButton value={command} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[13px] text-neutral-200">
        <span className="text-neutral-600">$ </span>
        {command}
      </pre>
    </div>
  )
}

function CopyButton({
  value,
  label = 'Copy',
  variant = 'plain',
}: {
  value: string
  label?: string
  variant?: 'plain' | 'bordered'
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded text-[11px] text-neutral-400 outline-none transition-colors hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-walnut-500/50',
        variant === 'bordered'
          ? 'rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-neutral-300 hover:bg-neutral-800'
          : 'px-2 py-0.5 hover:bg-neutral-800',
      )}
    >
      <Copy size={12} />
      {copied ? 'Copied' : label}
    </button>
  )
}
