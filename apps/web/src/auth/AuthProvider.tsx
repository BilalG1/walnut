import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { queryClient } from '../app/queryClient.ts'
import { authConfig } from '../lib/auth/config.ts'
import { decodeJwt } from '../lib/auth/jwt.ts'
import { signInWithOAuth, type OAuthProvider } from '../lib/auth/oauth.ts'
import { devLogin, localLogin } from '../lib/auth/session.ts'
import { clearTokens, getAccessToken, subscribe } from '../lib/auth/tokens.ts'

export interface AuthUser {
  id: string
  email?: string
  name?: string
}

export interface AuthState {
  user: AuthUser | null
  signInWithDevLogin: (email: string) => Promise<void>
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>
  /** Local (self-host) sign-in. No email → the default local user; an email → that identity. */
  signInWithLocal: (email?: string) => Promise<void>
  /** Local auth only: the automatic sign-in is still in flight (vs done or needing manual entry). */
  localAutoPending: boolean
  signOut: () => void
}

/** Suppress the automatic local sign-in after an explicit sign-out, so the user lands on
 * the local sign-in screen (to switch identity) instead of being signed straight back in.
 * Session-scoped: a fresh tab/visit auto-signs-in again. */
const LOCAL_SUPPRESS_KEY = 'walnut.local.suppressAuto'

function suppressAutoSignIn(): boolean {
  try {
    return sessionStorage.getItem(LOCAL_SUPPRESS_KEY) === '1'
  } catch {
    return false
  }
}

/** Derive the signed-in user from the stored access token (display only). */
function readUser(): AuthUser | null {
  const token = getAccessToken()
  if (token === null) {
    return null
  }
  const claims = decodeJwt(token)
  if (claims?.sub === undefined) {
    return null
  }
  return { id: claims.sub, email: claims.email, name: claims.name }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readUser())
  // In local mode we attempt an automatic sign-in; start "pending" so the sign-in screen
  // shows a spinner rather than the manual form during that first attempt — unless a prior
  // sign-out suppressed it (then go straight to the manual form, no spinner flash).
  const [localAutoPending, setLocalAutoPending] = useState<boolean>(authConfig.localAuth && !suppressAutoSignIn())

  // The token store is the source of truth; mirror its sign-in/out events into state
  // (also catches a failed refresh that clears the session under us). On any identity
  // change — sign-in, sign-out, or switching to a different local user — drop the whole
  // React Query cache so one identity's data can never bleed into the next session.
  const prevUserIdRef = useRef<string | null>(user?.id ?? null)
  useEffect(
    () =>
      subscribe(() => {
        const next = readUser()
        const nextId = next?.id ?? null
        if (prevUserIdRef.current !== nextId) {
          prevUserIdRef.current = nextId
          queryClient.clear()
        }
        setUser(next)
      }),
    [],
  )

  // Local auth: auto-sign-in as the default user whenever there's no session — on first
  // load and again if a stale session is cleared (e.g. the API restarted with a new key).
  // Skipped after an explicit sign-out so the user can pick a different identity.
  useEffect(() => {
    if (!authConfig.localAuth || user !== null) {
      return
    }
    if (suppressAutoSignIn()) {
      setLocalAutoPending(false)
      return
    }
    let cancelled = false
    setLocalAutoPending(true)
    localLogin()
      .catch(() => {
        // Leave it to the manual local sign-in screen (e.g. the API isn't up yet).
      })
      .finally(() => {
        if (!cancelled) {
          setLocalAutoPending(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const value = useMemo<AuthState>(
    () => ({
      user,
      localAutoPending,
      // Token writes emit, so the subscription above updates `user`.
      signInWithDevLogin: (email: string) => devLogin(email),
      // Navigates away to the provider; control returns via the OAuth callback page.
      signInWithOAuth: (provider: OAuthProvider) => signInWithOAuth(provider),
      signInWithLocal: async (email?: string) => {
        try {
          sessionStorage.removeItem(LOCAL_SUPPRESS_KEY)
        } catch {
          // sessionStorage unavailable (private mode); auto-sign-in just won't be suppressed.
        }
        await localLogin(email)
      },
      signOut: () => {
        if (authConfig.localAuth) {
          try {
            sessionStorage.setItem(LOCAL_SUPPRESS_KEY, '1')
          } catch {
            // ignore — worst case the user is auto-signed back in
          }
        }
        clearTokens()
      },
    }),
    [user, localAutoPending],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth must be used within <AuthProvider>')
  }
  return ctx
}
