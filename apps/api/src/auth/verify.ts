import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose'

/**
 * Identity extracted from a verified Hexclave access token. `userId` is the token's
 * `sub`; `email`/`name` ride along in the token (see the Hexclave JWT claims) so the
 * dashboard can JIT-provision a user without a second network call.
 */
export interface AuthClaims {
  userId: string
  email?: string
  name?: string
}

/** Verifies a user access token and returns its identity claims, or throws. */
export interface AuthVerifier {
  verify(token: string): Promise<AuthClaims>
}

/** Hexclave-issued ES256 tokens are signed against ALG; we never accept anything else. */
const ALGORITHMS = ['ES256']

async function verifyWith(
  getKey: JWTVerifyGetKey,
  issuer: string,
  audience: string,
  token: string,
): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, getKey, {
    issuer,
    audience,
    algorithms: ALGORITHMS,
    // jose enforces `exp` only when present; require it so a token minted without
    // one can never be a permanent credential. Small tolerance absorbs clock skew.
    requiredClaims: ['exp'],
    clockTolerance: 5,
  })
  const sub = payload.sub
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('Access token is missing a `sub` claim.')
  }
  return {
    userId: sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
  }
}

export interface RemoteAuthConfig {
  /** Hexclave API base, e.g. `https://api.hexclave.com`. */
  apiBaseUrl: string
  /** The Hexclave project id; also the token `aud`. */
  projectId: string
}

/**
 * Production/dev verifier: fetches the real Hexclave JWKS over HTTPS (cached by jose)
 * and checks signature + issuer + audience + expiry. This is the ONLY auth code path
 * — dev and tests differ only in which keys/issuer it points at, never in logic.
 */
export function createRemoteVerifier(config: RemoteAuthConfig): AuthVerifier {
  const issuer = `${config.apiBaseUrl}/api/v1/projects/${config.projectId}`
  const audience = config.projectId
  const getKey = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
  return { verify: (token) => verifyWith(getKey, issuer, audience, token) }
}

export interface LocalAuthConfig {
  jwks: JSONWebKeySet
  issuer: string
  audience: string
}

/** Test verifier: verifies against an in-memory JWKS so the suite is hermetic (no
 * network) while still exercising the real `jwtVerify` path. */
export function createLocalVerifier(config: LocalAuthConfig): AuthVerifier {
  const getKey = createLocalJWKSet(config.jwks)
  return { verify: (token) => verifyWith(getKey, config.issuer, config.audience, token) }
}
