import { createLocalKeypair } from './local-keypair.ts'
import type { AuthVerifier } from './verify.ts'

/**
 * Test-only auth: a freshly generated ES256 keypair (see local-keypair.ts) whose public
 * half backs a local verifier, plus a `mintToken` that signs Hexclave-shaped access
 * tokens with the private half. Lets the suite exercise the REAL verification middleware
 * offline (no Hexclave, no network) instead of stubbing auth out — the dev/test/prod auth
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
  const keypair = await createLocalKeypair({
    kid: TEST_KID,
    issuer: TEST_AUTH_ISSUER,
    audience: TEST_AUTH_AUDIENCE,
  })

  function mintToken(userId: string, claims: { email?: string; name?: string } = {}): Promise<string> {
    const payload: Record<string, unknown> = { role: 'authenticated', sub: userId }
    if (claims.email !== undefined) payload.email = claims.email
    if (claims.name !== undefined) payload.name = claims.name
    return keypair.sign(payload, { audience: TEST_AUTH_AUDIENCE, expiresIn: '1h' })
  }

  return { verifier: keypair.verifier, mintToken }
}
