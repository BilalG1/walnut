/** Pull the token out of an `Authorization: Bearer <token>` header. Returns
 * undefined when the header is absent or malformed. Shared by agent-key auth and
 * user (JWT) auth. */
export function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token !== undefined && token.length > 0 ? token : undefined
}
