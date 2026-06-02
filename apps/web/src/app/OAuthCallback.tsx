import { Button, Spinner } from '@walnut/ui'
import { useEffect, useState } from 'react'
import { completeOAuthSignIn } from '../lib/auth/oauth.ts'

// Module-level so a StrictMode double-mount exchanges the single-use code exactly once.
let started = false

/** The OAuth redirect target: finishes the token exchange, then the auth state flips
 * and {@link RootGate} swaps in the router. */
export function OAuthCallback() {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (started) {
      return
    }
    started = true
    void completeOAuthSignIn().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    })
  }, [])

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-3 px-5 py-16 text-center">
      {error === null ? (
        <>
          <Spinner />
          <p className="text-sm text-neutral-400">Completing sign-in…</p>
        </>
      ) : (
        <>
          <p className="text-sm text-red-400">{error}</p>
          <Button variant="ghost" onClick={() => window.location.assign('/')}>
            Back to sign in
          </Button>
        </>
      )}
    </div>
  )
}
