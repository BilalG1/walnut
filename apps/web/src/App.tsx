import { useEffect, useState } from 'react'
import { useAuth, type AuthUser } from './auth/AuthProvider.tsx'
import { SignIn } from './auth/SignIn.tsx'
import { AgentsTab } from './components/AgentsTab.tsx'
import { NotificationsTab } from './components/NotificationsTab.tsx'
import { ProjectsTab } from './components/ProjectsTab.tsx'
import { Button } from './components/ui.tsx'
import { useAgents, useProjects, useScopeRequests } from './hooks.ts'

type Tab = 'projects' | 'agents' | 'notifications'

const TABS: { id: Tab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'agents', label: 'Agents' },
  { id: 'notifications', label: 'Notifications' },
]

/** Auth gate: render the sign-in screen until there's a session, then the dashboard. */
export function App() {
  const { user } = useAuth()
  if (user === null) {
    return <SignIn />
  }
  return <Dashboard user={user} />
}

function Dashboard({ user }: { user: AuthUser }) {
  const { signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('projects')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const projects = useProjects()
  const scopeRequests = useScopeRequests()
  const agents = useAgents(selectedProjectId)

  // Default the agent project selector to the first project once loaded.
  useEffect(() => {
    if (projects.data.length === 0) {
      setSelectedProjectId(null)
      return
    }
    const stillExists = projects.data.some((p) => p.id === selectedProjectId)
    if (!stillExists) {
      setSelectedProjectId(projects.data[0]?.id ?? null)
    }
  }, [projects.data, selectedProjectId])

  const pendingCount = scopeRequests.data.filter((r) => r.status === 'pending').length

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <span className="text-2xl">🌰</span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-50">Walnut Cloud</h1>
          <p className="text-xs text-neutral-500">The agent-native cloud — Postgres, scoped for AI agents.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-neutral-500 sm:inline" title={user.id}>
            {user.email ?? user.name ?? user.id}
          </span>
          <Button variant="subtle" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border-walnut-500 text-neutral-50'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
            {t.id === 'notifications' && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-walnut-500 px-1 text-[10px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="flex-1">
        {tab === 'projects' && (
          <ProjectsTab
            projects={projects.data}
            loading={projects.loading}
            error={projects.error}
            onChange={projects.refresh}
          />
        )}
        {tab === 'agents' && (
          <AgentsTab
            projects={projects.data}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            agents={agents.data}
            loading={agents.loading}
            error={agents.error}
            onAgentsChange={agents.refresh}
            onScopeRequested={() => void scopeRequests.refresh()}
          />
        )}
        {tab === 'notifications' && (
          <NotificationsTab
            requests={scopeRequests.data}
            projects={projects.data}
            loading={scopeRequests.loading}
            error={scopeRequests.error}
            onResolved={async () => {
              await scopeRequests.refresh()
              await agents.refresh()
            }}
          />
        )}
      </main>
    </div>
  )
}
