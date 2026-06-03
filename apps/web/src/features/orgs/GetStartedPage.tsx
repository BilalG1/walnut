import { useNavigate } from '@tanstack/react-router'
import { DEFAULT_WALNUT_API_URL, DEFAULT_WALNUT_WEB_URL } from '@walnut/core/urls'
import { ArrowRight, Bell, Check, ChevronRight, Copy, Database, KeyRound, ShieldCheck } from '@walnut/icons'
import { Button, cn, Input, Spinner } from '@walnut/ui'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { API_URL } from '../../api.ts'
import { useScope } from '../../app/useScope.ts'
import {
  useCompleteOnboarding,
  useCreateAgent,
  useCreateProject,
  useOrgRequests,
  useRotateAgentKey,
} from '../../data/queries.ts'
import { clearOnboarding, loadOnboarding, saveOnboarding } from '../../lib/onboarding.ts'

/** Guided first-run flow: create a project, connect an agent via the CLI, then watch the
 * agent's first scope request arrive — at which point onboarding is marked complete and the
 * user is handed off to the Requests tab to approve it. Org-scoped (a project doesn't exist
 * until step 0 completes), so this lives at `/orgs/$orgId/get-started`. Progress is persisted
 * client-side (non-secret) so a reload resumes mid-flow instead of restarting. */
export function GetStartedPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <GetStartedView orgId={orgId} />
}

const AGENT_NAME = 'my-agent'

const STEPS: { title: string; blurb: string; icon: typeof Database }[] = [
  { title: 'Create project', blurb: 'A dedicated Postgres database', icon: Database },
  { title: 'Connect agent', blurb: 'Install the CLI and log in', icon: KeyRound },
  { title: 'Grant access', blurb: 'Approve its first request', icon: ShieldCheck },
]

/** The CLI installer command, pointed at whatever origin actually serves `/install` (the
 * local dev server in dev, walnut.sh in production — see vite.config + DEFAULT_WALNUT_WEB_URL). */
function installCommand(): string {
  const base = (import.meta.env.VITE_INSTALL_URL as string | undefined)?.trim() || DEFAULT_WALNUT_WEB_URL
  return `curl -fsSL ${base}/install | sh`
}

/** `walnut login` for the agent's key. Only appends `--api-url` when the dashboard talks to a
 * non-default API (e.g. local dev), so the CLI is pointed at the same backend; the flag is
 * persisted into `~/.walnut/` so every later command uses it too. */
function loginCommand(apiKey: string): string {
  const base = `walnut login --api-key ${apiKey}`
  return API_URL === DEFAULT_WALNUT_API_URL ? base : `${base} --api-url ${API_URL}`
}

function GetStartedView({ orgId }: { orgId: string }) {
  const navigate = useNavigate()
  const saved = useMemo(() => loadOnboarding(localStorage, orgId), [orgId])

  const projectMut = useCreateProject(orgId)
  const agentMut = useCreateAgent(orgId)
  const rotateMut = useRotateAgentKey(orgId)
  const completeMut = useCompleteOnboarding()

  const [step, setStep] = useState(saved?.step ?? 0)
  const [projectName, setProjectName] = useState('My project')
  const [project, setProject] = useState<{ id: string; name: string } | null>(
    saved?.projectId !== undefined && saved.projectName !== undefined
      ? { id: saved.projectId, name: saved.projectName }
      : null,
  )
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(
    saved?.agentId !== undefined && saved.agentName !== undefined
      ? { id: saved.agentId, name: saved.agentName }
      : null,
  )
  // The agent's plaintext key is a secret: it lives only in memory for this page's life,
  // never in localStorage. On a reload we recover it by rotating a fresh one (see below).
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // Bumped to re-trigger the agent-setup effect after a failure (see retrySetup).
  const [setupNonce, setSetupNonce] = useState(0)

  /** Persist resumable (non-secret) progress, merging explicit overrides over current state. */
  const persist = useCallback(
    (next: Partial<Parameters<typeof saveOnboarding>[1]>): void => {
      saveOnboarding(localStorage, {
        orgId,
        step,
        projectId: project?.id,
        projectName: project?.name,
        agentId: agent?.id,
        agentName: agent?.name,
        ...next,
      })
    },
    [orgId, step, project, agent],
  )

  function goStep(i: number): void {
    setStep(i)
    persist({ step: i })
  }

  // On entering step 1, make sure we have an agent + a usable key. Created once; on a reload
  // (agent known, key lost) we rotate to get a fresh key. A ref guards against double-firing
  // (incl. StrictMode) and, on failure, *stays set* so we never auto-retry in a loop — the user
  // re-triggers via retrySetup, which bumps setupNonce.
  const agentInit = useRef(false)
  useEffect(() => {
    if (step !== 1 || apiKey !== null || agentInit.current) {
      return
    }
    agentInit.current = true
    if (agent === null) {
      agentMut.mutate(
        { name: AGENT_NAME },
        {
          onSuccess: (created) => {
            setAgent({ id: created.id, name: created.name })
            setApiKey(created.apiKey)
            persist({ step: 1, agentId: created.id, agentName: created.name })
          },
        },
      )
    } else {
      rotateMut.mutate(agent.id, { onSuccess: (rotated) => setApiKey(rotated.apiKey) })
    }
  }, [step, agent, apiKey, agentMut, rotateMut, persist, setupNonce])

  /** Recover from a failed agent create/rotate: clear the guard + mutation error and re-run. */
  function retrySetup(): void {
    agentInit.current = false
    agentMut.reset()
    rotateMut.reset()
    setSetupNonce((n) => n + 1)
  }

  // Poll for the agent's incoming request only while we're waiting on it in step 2.
  const pending = useOrgRequests(orgId, 'pending', { refetchInterval: step === 2 && !done ? 2000 : false })
  const incoming = agent === null ? null : (pending.data?.find((r) => r.agentId === agent.id) ?? null)

  // The moment the agent's first request lands, onboarding is complete: mark it server-side
  // (which reveals the sidebar) and hand the user off to the Requests tab to approve it.
  useEffect(() => {
    if (step === 2 && !done && incoming !== null) {
      setDone(true)
      clearOnboarding(localStorage)
      completeMut.mutate()
    }
  }, [step, done, incoming, completeMut])

  function submitProject(event: FormEvent): void {
    event.preventDefault()
    // Already created (e.g. the user stepped back to step 0): just advance, never make a second
    // project — re-creating would orphan the first one's database.
    if (project !== null) {
      goStep(1)
      return
    }
    const name = projectName.trim()
    if (name === '' || projectMut.isPending) {
      return
    }
    projectMut.mutate(name, {
      onSuccess: (created) => {
        setProject({ id: created.id, name: created.name })
        setStep(1)
        persist({ step: 1, projectId: created.id, projectName: created.name })
      },
    })
  }

  function skip(): void {
    clearOnboarding(localStorage)
    completeMut.mutate()
    void navigate({ to: '/orgs/$orgId', params: { orgId } })
  }

  function reviewRequest(): void {
    void navigate({ to: '/orgs/$orgId/requests', params: { orgId } })
  }

  const setupError = agentMut.error ?? rotateMut.error
  const promptText = `Use the walnut CLI already installed on this computer to query project "${project?.id ?? ''}" — connect to its database and list every table. If you don't have permission yet, request the access you need with the walnut CLI, then tell me you're waiting on my approval.`

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Walnut</h1>
          <p className="mt-1 text-sm text-muted">Give your first agent scoped access to a real database — in three steps.</p>
        </div>
        <button
          type="button"
          onClick={skip}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-subtle outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-walnut-500/50"
        >
          Skip
        </button>
      </div>

      {/* Horizontal stepper, above the action card */}
      <ol className="mb-7 flex items-center">
        {STEPS.map((s, i) => {
          const lastStep = STEPS.length - 1
          const isDone = i < step || (i === lastStep && done)
          const active = i === step && !(i === lastStep && done)
          const Icon = s.icon
          return (
            <Fragment key={s.title}>
              <li>
                <button
                  type="button"
                  disabled={i >= step}
                  onClick={() => i < step && goStep(i)}
                  className={cn('flex items-center gap-2.5 text-left', i < step ? 'cursor-pointer' : 'cursor-default')}
                >
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors',
                      isDone
                        ? 'border-transparent bg-walnut-500 text-white'
                        : active
                          ? 'border-walnut-500 bg-walnut-500/10 text-accent'
                          : 'border-line-strong text-subtle',
                    )}
                  >
                    {isDone ? <Check size={17} strokeWidth={2.6} /> : <Icon size={16} />}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className={cn('block text-sm font-medium leading-tight', active || isDone ? 'text-fg' : 'text-subtle')}>
                      {s.title}
                    </span>
                    <span className="block text-xs text-faint">{s.blurb}</span>
                  </span>
                </button>
              </li>
              {i < STEPS.length - 1 ? (
                <li aria-hidden className={cn('mx-3 h-px flex-1', i < step ? 'bg-walnut-500/50' : 'bg-hover')} />
              ) : null}
            </Fragment>
          )
        })}
      </ol>

      {/* Active panel */}
      <div className="rounded-2xl border border-line bg-surface">
        <div key={done ? 'done' : step} className="wnut-fade-in p-8">
          {step === 0 ? (
            <section>
              <PanelHeader
                icon={<Database size={20} />}
                title="Create your first project"
                blurb="Every project gets a dedicated Postgres database with an inert main branch."
              />
              <form onSubmit={submitProject} className="mt-6">
                <label htmlFor="gs-project" className="mb-1.5 block text-xs font-medium tracking-wide text-muted">
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
                {projectMut.error !== null ? <p className="mt-2 text-xs text-danger">{projectMut.error.message}</p> : null}
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
                blurb={`We created an agent called “${AGENT_NAME}”. Install the CLI and log it in — it starts with zero scopes.`}
              />
              {apiKey === null ? (
                setupError !== null ? (
                  <div className="mt-8">
                    <p className="text-sm text-danger">{setupError.message}</p>
                    <Button variant="ghost" className="mt-3" onClick={retrySetup}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="mt-8 flex items-center gap-2 text-sm text-muted">
                    <Spinner className="h-4 w-4" />
                    Setting up {AGENT_NAME}…
                  </div>
                )
              ) : (
                <div className="mt-6 space-y-4 wnut-slide-in">
                  <CommandBlock label="install" command={installCommand()} />
                  <CommandBlock label="log in" command={loginCommand(apiKey)} />
                  <div className="pt-1">
                    <Button onClick={() => goStep(2)}>
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

              {done ? (
                <div className="mt-8 text-center wnut-slide-in">
                  <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck size={30} />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">{agent?.name ?? 'Your agent'} is asking for access 🎉</h3>
                  <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
                    That&apos;s the whole loop. Review the request to approve exactly what it gets — enforced by its own
                    Postgres role, not just a checkbox.
                  </p>
                  <div className="mt-7 flex justify-center">
                    <Button onClick={reviewRequest}>
                      Review request
                      <ArrowRight size={16} />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <div className="rounded-xl border border-walnut-500/30 bg-walnut-500/5 p-4">
                    <p className="text-sm leading-relaxed text-fg">{promptText}</p>
                    <div className="mt-3">
                      <CopyButton value={promptText} label="Copy prompt" variant="bordered" />
                    </div>
                  </div>

                  <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
                    <div className="relative mx-auto mb-5 h-14 w-14">
                      <span className="absolute inset-0 rounded-full bg-walnut-500/20 wnut-pulse-ring" />
                      <span className="absolute inset-0 rounded-full bg-walnut-500/20 wnut-pulse-ring" style={{ animationDelay: '0.9s' }} />
                      <span className="relative grid h-14 w-14 place-items-center rounded-full border border-walnut-500/40 bg-sunken text-accent">
                        <Bell size={22} />
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-fg">
                      <Spinner className="h-4 w-4" />
                      Waiting for {agent?.name ?? 'your agent'} to request access…
                    </div>
                    <p className="mx-auto mt-1.5 max-w-sm text-xs text-subtle">
                      When it runs <span className="font-mono text-muted">walnut scope request</span>, you&apos;ll be taken to
                      approve it.
                    </p>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ icon, title, blurb }: { icon: ReactNode; title: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-sunken text-accent">{icon}</span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{blurb}</p>
      </div>
    </div>
  )
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] text-subtle">{label}</span>
        <CopyButton value={command} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[13px] text-fg">
        <span className="text-faint">$ </span>
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
        'inline-flex items-center gap-1.5 rounded text-[11px] text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-walnut-500/50',
        variant === 'bordered'
          ? 'rounded-md border border-line-strong bg-sunken px-2.5 py-1 text-fg-secondary hover:bg-hover'
          : 'px-2 py-0.5 hover:bg-hover',
      )}
    >
      <Copy size={12} />
      {copied ? 'Copied' : label}
    </button>
  )
}
