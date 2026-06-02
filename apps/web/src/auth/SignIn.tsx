import { useState, type FormEvent } from 'react'
import { Button, Card, TextInput } from '../components/ui.tsx'
import { authConfig } from '../lib/auth/config.ts'
import { useAuth } from './AuthProvider.tsx'

export function SignIn() {
  const { signInWithDevLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center px-5 py-16">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <span className="text-3xl">🌰</span>
        <h1 className="text-lg font-semibold tracking-tight text-neutral-50">Sign in to Walnut Cloud</h1>
        <p className="text-xs text-neutral-500">The agent-native cloud.</p>
      </div>

      <Card className="w-full p-5">
        {/* OAuth providers (Google / GitHub) are added in step 4. */}
        {authConfig.devBypass ? (
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
            {error !== null && <p className="text-xs text-red-400">{error}</p>}
            <p className="text-[11px] leading-relaxed text-neutral-600">
              Dev only: trades an email for a real session without OAuth. Disabled in production.
            </p>
          </form>
        ) : (
          <p className="text-sm text-neutral-400">No sign-in providers are configured.</p>
        )}
      </Card>
    </div>
  )
}
