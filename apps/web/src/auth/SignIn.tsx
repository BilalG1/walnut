import { useState, type FormEvent } from 'react'
import githubLogo from '../assets/github.svg'
import googleLogo from '../assets/google.svg'
import { Button, Card } from '../components/ui.tsx'
import { authConfig } from '../lib/auth/config.ts'
import type { OAuthProvider } from '../lib/auth/oauth.ts'
import { useAuth } from './AuthProvider.tsx'

const PROVIDERS: { id: OAuthProvider; label: string; logo: string }[] = [
  { id: 'google', label: 'Continue with Google', logo: googleLogo },
  { id: 'github', label: 'Continue with GitHub', logo: githubLogo },
]

export function SignIn() {
  const { signInWithOAuth } = useAuth()
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasOAuth = authConfig.projectId !== ''

  async function onOAuth(provider: OAuthProvider) {
    setPendingProvider(provider)
    setError(null)
    try {
      await signInWithOAuth(provider) // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
      setPendingProvider(null)
    }
  }

  return (
    <>
      {authConfig.devBypass && <DevLoginCorner />}

      <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center px-5 py-16">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-3xl">🌰</span>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-50">Sign in to Walnut Cloud</h1>
          <p className="text-xs text-neutral-500">The agent-native cloud.</p>
        </div>

        <Card className="flex w-full flex-col gap-2 p-5">
          {hasOAuth ? (
            PROVIDERS.map((provider) => (
              <Button
                key={provider.id}
                variant="ghost"
                disabled={pendingProvider !== null}
                onClick={() => void onOAuth(provider.id)}
              >
                <img src={provider.logo} alt="" className="h-4 w-4" />
                {pendingProvider === provider.id ? 'Redirecting…' : provider.label}
              </Button>
            ))
          ) : (
            <p className="text-sm text-neutral-400">No sign-in providers are configured.</p>
          )}
          {error !== null && <p className="text-xs text-red-400">{error}</p>}
        </Card>
      </div>
    </>
  )
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8h9M8 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Minimal, unobtrusive dev-login affordance pinned to the corner, so it never alters
 * how the real sign-in screen looks. Dev-only (see authConfig.devBypass). */
function DevLoginCorner() {
  const { signInWithDevLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (email.trim() === '') {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await signInWithDevLogin(email.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      title={error ?? undefined}
      className="fixed left-3 top-3 z-50 flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-2 py-1.5 backdrop-blur"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">dev login</span>
      <input
        id="dev-email"
        type="email"
        required
        aria-label="dev login email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={`w-32 rounded border bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-walnut-500 ${
          error !== null ? 'border-red-500/70' : 'border-neutral-700'
        }`}
      />
      <button
        type="submit"
        disabled={submitting || email.trim() === ''}
        aria-label="Sign in"
        className="inline-flex h-5 w-5 items-center justify-center rounded bg-walnut-500 text-white transition hover:bg-walnut-600 disabled:opacity-40"
      >
        <ArrowRightIcon />
      </button>
    </form>
  )
}
