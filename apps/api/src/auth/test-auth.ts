import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose'
import { createLocalVerifier, type AuthVerifier } from './verify.ts'

/**
 * Test-only auth: a freshly generated ES256 keypair whose public half backs a local
 * verifier, plus a `mintToken` that signs Hexclave-shaped access tokens with the
 * private half. Lets the suite exercise the REAL verification middleware offline
 * (no Hexclave, no network) instead of stubbing auth out — the dev/test/prod auth
 * code is identical; only the keys + issuer differ.
 */
export const TEST_AUTH_ISSUER = 'https://test.hexclave.local'
export const TEST_AUTH_AUDIENCE = 'walnut-test-project'
const TEST_KID = 'walnut-test-key'

export interface TestAuth {
  verifier: AuthVerifier
  /** Mint a signed access token for a user, with optional `email`/`name` claims. */
  mintToken: (userId: string, claims?: { email?: string; name?: string }) => Promise<string>
}

export async function createTestAuth(): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: TEST_KID, alg: 'ES256', use: 'sig' }
  const jwks: JSONWebKeySet = { keys: [publicJwk] }
  const verifier = createLocalVerifier({ jwks, issuer: TEST_AUTH_ISSUER, audience: TEST_AUTH_AUDIENCE })

  async function mintToken(userId: string, claims: { email?: string; name?: string } = {}): Promise<string> {
    const payload: Record<string, unknown> = { role: 'authenticated' }
    if (claims.email !== undefined) payload.email = claims.email
    if (claims.name !== undefined) payload.name = claims.name
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', kid: TEST_KID })
      .setSubject(userId)
      .setIssuer(TEST_AUTH_ISSUER)
      .setAudience(TEST_AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)
  }

  return { verifier, mintToken }
}
