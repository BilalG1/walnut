/** PKCE + state helpers for the OAuth flow, using Web Crypto (no dependency). */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/** A high-entropy PKCE code verifier (43 chars of base64url for 32 random bytes). */
export function generateCodeVerifier(): string {
  return randomToken(32)
}

/** An opaque CSRF state value tying the callback back to this request. */
export function generateState(): string {
  return randomToken(16)
}

/** The S256 code challenge: base64url(SHA-256(verifier)). */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}
