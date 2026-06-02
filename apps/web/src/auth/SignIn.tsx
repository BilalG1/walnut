import { useState, type FormEvent } from 'react'
import { Button, Card, TextInput } from '../components/ui.tsx'
import { authConfig } from '../lib/auth/config.ts'
import type { OAuthProvider } from '../lib/auth/oauth.ts'
import { useAuth } from './AuthProvider.tsx'

const PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
]

export function SignIn() {
  const { signInWithDevLogin, signInWithOAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasOAuth = authConfig.projectId !== '' && authConfig.publishableClientKey !== ''

  async function onDevSubmit(event: FormEvent) {
    event.preventDefault()
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
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center px-5 py-16">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <span className="text-3xl">🌰</span>
        <h1 className="text-lg font-semibold tracking-tight text-neutral-50">Sign in to Walnut Cloud</h1>
        <p className="text-xs text-neutral-500">The agent-native cloud.</p>
      </div>

      <Card className="flex w-full flex-col gap-4 p-5">
        {hasOAuth && (
          <div className="flex flex-col gap-2">
            {PROVIDERS.map((provider) => (
              <Button
                key={provider.id}
                variant="ghost"
                disabled={pendingProvider !== null}
                onClick={() => void onOAuth(provider.id)}
              >
                {pendingProvider === provider.id ? 'Redirecting…' : provider.label}
              </Button>
            ))}
          </div>
        )}

        {hasOAuth && authConfig.devBypass && (
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-neutral-800" />
            <span className="text-[11px] uppercase tracking-wide text-neutral-600">or</span>
            <span className="h-px flex-1 bg-neutral-800" />
          </div>
        )}

        {authConfig.devBypass && (
          <form onSubmit={onDevSubmit} className="flex flex-col gap-3">
            <label className="text-xs font-medium text-neutral-400" htmlFor="dev-email">
              Dev login — sign in as any email
            </label>
            <TextInput
              id="dev-email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" disabled={submitting || email.trim().length === 0}>
              {submitting ? 'Signing in…' : 'Continue'}
            </Button>
            <p className="text-[11px] leading-relaxed text-neutral-600">
              Dev only: trades an email for a real session without OAuth. Disabled in production.
            </p>
          </form>
        )}

        {!hasOAuth && !authConfig.devBypass && (
          <p className="text-sm text-neutral-400">No sign-in providers are configured.</p>
        )}

        {error !== null && <p className="text-xs text-red-400">{error}</p>}
      </Card>
    </div>
  )
}
