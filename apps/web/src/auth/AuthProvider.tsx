import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { decodeJwt } from '../lib/auth/jwt.ts'
import { signInWithOAuth, type OAuthProvider } from '../lib/auth/oauth.ts'
import { devLogin } from '../lib/auth/session.ts'
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
  signOut: () => void
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

  // The token store is the source of truth; mirror its sign-in/out events into state
  // (also catches a failed refresh that clears the session under us).
  useEffect(() => subscribe(() => setUser(readUser())), [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      // Token writes emit, so the subscription above updates `user`.
      signInWithDevLogin: (email: string) => devLogin(email),
      // Navigates away to the provider; control returns via the OAuth callback page.
      signInWithOAuth: (provider: OAuthProvider) => signInWithOAuth(provider),
      signOut: () => clearTokens(),
    }),
    [user],
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
