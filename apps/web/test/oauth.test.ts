import { afterEach, describe, expect, test } from 'bun:test'
import { buildAuthorizeUrl, completeOAuthSignIn } from '../src/lib/auth/oauth.ts'
import { clearTokens, getTokens } from '../src/lib/auth/tokens.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  sessionStorage.clear()
  clearTokens()
  window.location.href = 'http://localhost/'
})

function setCallbackUrl(search: string): void {
  window.location.href = `http://localhost/oauth-callback${search}`
}

describe('buildAuthorizeUrl', () => {
  test('includes the PKCE + flow params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        provider: 'google',
        state: 'st',
        codeChallenge: 'cc',
        redirectUri: 'https://app.example/oauth-callback',
      }),
    )
    expect(url.pathname).toBe('/api/v1/auth/oauth/authorize/google')
    expect(url.searchParams.get('code_challenge')).toBe('cc')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/oauth-callback')
    expect(url.searchParams.get('grant_type')).toBe('authorization_code')
    expect(url.searchParams.get('hexclave_response_mode')).toBe('json')
  })

  test('falls back to the public-client sentinel when no publishable key is set', () => {
    // No VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY in the test env, so client_secret is the
    // sentinel the token endpoint accepts (an empty secret is rejected).
    const url = new URL(
      buildAuthorizeUrl({ provider: 'github', state: 's', codeChallenge: 'c', redirectUri: 'https://app/cb' }),
    )
    expect(url.searchParams.get('client_secret')).toBe('__stack_public_client__')
  })
})

describe('completeOAuthSignIn', () => {
  test('rejects a callback whose state has no stored verifier', async () => {
    setCallbackUrl('?code=abc&state=unknown')
    await expect(completeOAuthSignIn()).rejects.toThrow(/state mismatch/i)
  })

  test('surfaces a provider error param', async () => {
    setCallbackUrl('?error=access_denied&error_description=Nope')
    await expect(completeOAuthSignIn()).rejects.toThrow('Nope')
  })

  test('exchanges the code with the stored verifier and stores tokens', async () => {
    sessionStorage.setItem(
      'walnut.oauth.st',
      JSON.stringify({ verifier: 'the-verifier', redirectUri: 'https://app.example/oauth-callback' }),
    )
    setCallbackUrl('?code=the-code&state=st')

    const captured: { url?: string; body?: string } = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input)
      captured.body = String(init?.body)
      return Response.json({ access_token: 'AT', refresh_token: 'RT' })
    }) as unknown as typeof fetch

    await completeOAuthSignIn()

    expect(getTokens()).toEqual({ accessToken: 'AT', refreshToken: 'RT' })
    expect(captured.url).toContain('/api/v1/auth/oauth/token')
    expect(captured.body).toContain('grant_type=authorization_code')
    expect(captured.body).toContain('code=the-code')
    expect(captured.body).toContain('code_verifier=the-verifier')
    // The single-use state entry is consumed.
    expect(sessionStorage.getItem('walnut.oauth.st')).toBeNull()
  })
})
