import { RouterProvider } from '@tanstack/react-router'
import { useAuth } from '../auth/AuthProvider.tsx'
import { SignIn } from '../auth/SignIn.tsx'
import { isOAuthCallback } from '../lib/auth/oauth.ts'
import { OAuthCallback } from './OAuthCallback.tsx'
import { router } from './router.tsx'

/** Auth gate: signed out → sign-in (or the OAuth callback handler); signed in → the
 * routed dashboard. The router only mounts once authenticated, so every route can
 * assume a user. */
export function RootGate() {
  const { user } = useAuth()
  if (user === null) {
    return isOAuthCallback() ? <OAuthCallback /> : <SignIn />
  }
  return <RouterProvider router={router} />
}
