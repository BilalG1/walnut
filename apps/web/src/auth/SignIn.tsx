import { Button } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
import { useTheme } from '../app/theme.tsx'
import githubLogoDark from '../assets/github-dark.svg'
import githubLogoLight from '../assets/github-light.svg'
import googleLogo from '../assets/google.svg'
import walnutLogoDark from '../assets/walnut-logo-dark.svg'
import walnutLogoLight from '../assets/walnut-logo-light.svg'
import { authConfig } from '../lib/auth/config.ts'
import type { OAuthProvider } from '../lib/auth/oauth.ts'
import { useAuth } from './AuthProvider.tsx'

/** The single default identity for a self-host instance (matches the API's default). */
const DEFAULT_LOCAL_EMAIL = 'user@walnut.local'

export function SignIn() {
  // Self-host (local auth): a built-in, passwordless sign-in. The dashboard auto-signs-in
  // as the default user, so this screen is mostly a brief spinner — and the manual switch-
  // user form after an explicit sign-out.
  if (authConfig.localAuth) {
    return <LocalSignIn />
  }
  return <OAuthSignIn />
}

function OAuthSignIn() {
  const { signInWithOAuth } = useAuth()
  const { theme } = useTheme()
  const walnutLogo = theme === 'dark' ? walnutLogoDark : walnutLogoLight
  const githubLogo = theme === 'dark' ? githubLogoDark : githubLogoLight
  const providers: { id: OAuthProvider; label: string; logo: string }[] = [
    { id: 'google', label: 'Continue with Google', logo: googleLogo },
    { id: 'github', label: 'Continue with GitHub', logo: githubLogo },
  ]
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
          <img src={walnutLogo} alt="Walnut Cloud" className="h-12 w-12" />
          <h1 className="text-lg font-semibold tracking-tight text-fg">Sign in to Walnut</h1>
          <p className="text-xs text-subtle">Sign in to Walnut</p>
        </div>

        <div className="flex w-full flex-col gap-2">
          {hasOAuth ? (
            providers.map((provider) => (
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
            <p className="text-sm text-muted">No sign-in providers are configured.</p>
          )}
          {error !== null && <p className="text-xs text-danger">{error}</p>}
        </div>
      </div>
    </>
  )
}

/**
 * Self-host sign-in. The dashboard auto-signs-in as the default local user, so this is
 * usually just a momentary spinner. After an explicit sign-out (or if the auto sign-in
 * fails), it offers a one-click "continue as the default user" plus an optional field to
 * sign in as a different (stable) identity for local multi-user testing.
 */
function LocalSignIn() {
  const { signInWithLocal, localAutoPending } = useAuth()
  const { theme } = useTheme()
  const walnutLogo = theme === 'dark' ? walnutLogoDark : walnutLogoLight
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(asEmail?: string) {
    setSubmitting(true)
    setError(null)
    try {
      await signInWithLocal(asEmail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
      setSubmitting(false)
    }
  }

  const busy = localAutoPending || submitting

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center px-5 py-16">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <img src={walnutLogo} alt="Walnut Cloud" className="h-12 w-12" />
        <h1 className="text-lg font-semibold tracking-tight text-fg">Welcome to Walnut</h1>
        <p className="text-xs text-subtle">Self-hosted · signed in locally, no account needed</p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button variant="primary" disabled={busy} onClick={() => void signIn()}>
          {localAutoPending ? 'Signing you in…' : `Continue as ${DEFAULT_LOCAL_EMAIL}`}
        </Button>

        {!localAutoPending && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (email.trim() !== '') {
                void signIn(email.trim())
              }
            }}
            className="flex flex-col gap-1.5"
          >
            <label htmlFor="local-email" className="text-[11px] uppercase tracking-wide text-subtle">
              or sign in as a different user
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="local-email"
                type="email"
                aria-label="local sign-in email"
                placeholder="you@walnut.local"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-w-0 flex-1 rounded border border-line-strong bg-sunken px-2 py-1 text-sm text-fg outline-none focus:border-walnut-500"
              />
              <button
                type="submit"
                disabled={busy || email.trim() === ''}
                aria-label="Sign in"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-walnut-500 text-white transition hover:bg-walnut-600 disabled:opacity-40"
              >
                <ArrowRightIcon />
              </button>
            </div>
          </form>
        )}

        {error !== null && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
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
      className="fixed left-3 top-3 z-50 flex items-center gap-1.5 rounded-lg border border-line bg-surface/80 px-2 py-1.5 backdrop-blur"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">dev login</span>
      <input
        id="dev-email"
        type="email"
        required
        aria-label="dev login email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={`w-32 rounded border bg-sunken px-1.5 py-0.5 text-xs text-fg outline-none focus:border-walnut-500 ${
          error !== null ? 'border-red-500/70' : 'border-line-strong'
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
