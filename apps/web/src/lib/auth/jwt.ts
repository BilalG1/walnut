/**
 * Decode a JWT's payload for display only — NO signature verification. The backend is
 * the sole authority on token validity; the frontend just reads `sub`/`email`/`name`
 * to render the signed-in user.
 */
export interface JwtClaims {
  sub?: string
  email?: string
  name?: string
  exp?: number
}

function base64UrlToJson(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.length % 4 === 0 ? base64 : base64 + '='.repeat(4 - (base64.length % 4))
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function decodeJwt(token: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length < 2 || parts[1] === undefined || parts[1] === '') {
    return null
  }
  try {
    const data = base64UrlToJson(parts[1]) as Record<string, unknown>
    return {
      sub: typeof data.sub === 'string' ? data.sub : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      name: typeof data.name === 'string' ? data.name : undefined,
      exp: typeof data.exp === 'number' ? data.exp : undefined,
    }
  } catch {
    return null
  }
}
