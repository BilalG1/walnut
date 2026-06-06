import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JSONWebKeySet, type JWTPayload } from 'jose'
import { createLocalVerifier, type AuthVerifier } from './verify.ts'

/**
 * A freshly generated, in-memory ES256 keypair that can both sign and verify
 * Hexclave-shaped JWTs offline (no network, no external keys). Shared by the test auth
 * (`createTestAuth`) and the self-host local auth provider (`createLocalAuth`) so the
 * keypair/JWKS/signer boilerplate lives in exactly one place.
 */
export interface LocalKeypair {
  /** Verifies tokens minted at the primary `audience` — the dashboard `AuthVerifier`. */
  verifier: AuthVerifier
  /** Sign a JWT with this keypair (caller supplies the audience + TTL). */
  sign(payload: Record<string, unknown>, opts: { audience: string; expiresIn: string }): Promise<string>
  /** Verify a token at an arbitrary audience (e.g. a refresh audience), returning its
   * payload, or null if the signature/issuer/audience/expiry checks fail. */
  verifyAt(token: string, audience: string): Promise<JWTPayload | null>
}

export async function createLocalKeypair(opts: {
  kid: string
  issuer: string
  audience: string
}): Promise<LocalKeypair> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: opts.kid, alg: 'ES256', use: 'sig' }
  const jwks: JSONWebKeySet = { keys: [publicJwk] }
  const verifier = createLocalVerifier({ jwks, issuer: opts.issuer, audience: opts.audience })

  return {
    verifier,
    sign(payload, { audience, expiresIn }) {
      return new SignJWT(payload)
        .setProtectedHeader({ alg: 'ES256', kid: opts.kid })
        .setIssuer(opts.issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey)
    },
    async verifyAt(token, audience) {
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          issuer: opts.issuer,
          audience,
          algorithms: ['ES256'],
          requiredClaims: ['exp'],
          clockTolerance: 5,
        })
        return payload
      } catch {
        return null
      }
    },
  }
}
