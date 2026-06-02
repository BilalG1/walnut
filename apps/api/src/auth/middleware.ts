import type { AppContext } from '../context.ts'
import { unauthorized } from '../errors.ts'
import { provisionUser } from '../services/organizations.ts'
import { extractBearer } from './bearer.ts'
import type { AuthClaims } from './verify.ts'

/**
 * Authenticate a dashboard request: verify the bearer access token and JIT-provision
 * the user (+ their personal org) on first sight. Returns the resolved `userId` for
 * the route to scope its queries by. Throws 401 when the token is missing or invalid.
 *
 * Each dashboard route group calls this from its own `.resolve` (mirroring the
 * agent-key auth in routes/agent.ts) rather than relying on Elysia plugin-scope
 * propagation — explicit and consistent with the codebase.
 */
export async function authenticate(
  ctx: AppContext,
  authorizationHeader: string | undefined,
): Promise<{ userId: string }> {
  const token = extractBearer(authorizationHeader)
  if (token === undefined) {
    throw unauthorized('Missing access token. Pass it as `Authorization: Bearer <token>`.')
  }
  let claims: AuthClaims
  try {
    claims = await ctx.auth.verify(token)
  } catch {
    throw unauthorized('Invalid or expired access token.')
  }
  await provisionUser(ctx, claims)
  return { userId: claims.userId }
}
