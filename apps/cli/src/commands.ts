import { type ApiClient, networkError, respond, statusOf } from './client.ts'
import { deleteCredentials, writeCredentials } from './credentials.ts'
import { ok, type CliResult } from './output.ts'

/** `login --api-key <key> [--api-url <url>]` → store credentials for later commands. */
export async function login(
  homeDir: string,
  apiKey: string,
  apiUrl: string | undefined,
  pretty: boolean,
): Promise<CliResult> {
  const path = await writeCredentials(homeDir, apiUrl === undefined ? { apiKey } : { apiKey, apiUrl })
  return ok({ loggedIn: true, apiUrl: apiUrl ?? null, credentialsPath: path }, pretty)
}

/** `logout` → remove stored credentials (idempotent). */
export async function logout(homeDir: string, pretty: boolean): Promise<CliResult> {
  const removed = await deleteCredentials(homeDir)
  return ok({ loggedOut: true, removed }, pretty)
}

/** `whoami` → GET /agent/v1/identity. */
export async function whoami(client: ApiClient, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.identity.get()
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `db query <sql>` → POST /agent/v1/query. */
export async function dbQuery(client: ApiClient, sql: string, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.query.post({ sql })
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `scope ls` → the agent's granted scopes (from identity) + its request log, in one object. */
export async function scopeLs(client: ApiClient, pretty: boolean): Promise<CliResult> {
  try {
    const identity = await client.agent.v1.identity.get()
    if (statusOf(identity) < 200 || statusOf(identity) >= 300) {
      return respond(identity, pretty)
    }
    const requests = await client.agent.v1['scope-requests'].get()
    if (statusOf(requests) < 200 || statusOf(requests) >= 300) {
      return respond(requests, pretty)
    }
    // Treaty's response-body types collapse across the package boundary, so read the
    // one field we need with a narrow cast (the runtime shape is the identity body).
    const granted = (identity.data as { scopes?: string[] } | null)?.scopes ?? []
    return ok({ granted, requests: requests.data ?? [] }, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `scope request <scope...>` → POST /agent/v1/scope-requests. */
export async function scopeRequest(
  client: ApiClient,
  scopes: string[],
  reason: string | undefined,
  pretty: boolean,
): Promise<CliResult> {
  try {
    const body = reason === undefined ? { scopes } : { scopes, reason }
    const res = await client.agent.v1['scope-requests'].post(body)
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}
