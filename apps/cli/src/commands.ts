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

/** Which project/branch a command targets. Both are optional: omit `projectId` and the
 * server uses the agent's sole project (erroring if it can reach several); omit `branch`
 * and it targets the project's default branch (main). */
export interface Target {
  projectId?: string
  branch?: string
}

/** `project ls` → GET /agent/v1/projects (every project in the agent's org: id + name). */
export async function projectLs(client: ApiClient, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.projects.get()
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `branch ls` → GET /agent/v1/branches (the target project's branches: id + name + default).
 * `--project` picks the project; omit it for the agent's sole project. */
export async function branchLs(client: ApiClient, projectId: string | undefined, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.branches.get({
      query: projectId === undefined ? {} : { projectId },
    })
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `db query <sql>` → POST /agent/v1/query, against the chosen project + branch. Only sends
 * the target fields the user actually set, so the server applies its own defaults. */
export async function dbQuery(client: ApiClient, sql: string, target: Target, pretty: boolean): Promise<CliResult> {
  try {
    const body = {
      sql,
      ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
      ...(target.branch === undefined ? {} : { branch: target.branch }),
    }
    const res = await client.agent.v1.query.post(body)
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

/** `scope request <scope...>` → POST /agent/v1/scope-requests. `--project` targets that project
 * and `--branch <name>` targets that branch of it (a branch-scoped grant); omit both and the
 * server defaults to the agent's sole project. With `--ttl` the scopes are time-boxed to that
 * many seconds once approved (else permanent). */
export async function scopeRequest(
  client: ApiClient,
  scopes: string[],
  reason: string | undefined,
  projectId: string | undefined,
  branch: string | undefined,
  expiresInSeconds: number | undefined,
  pretty: boolean,
): Promise<CliResult> {
  try {
    const body = {
      scopes,
      ...(reason === undefined ? {} : { reason }),
      ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(branch === undefined ? {} : { branch }),
    }
    const res = await client.agent.v1['scope-requests'].post(body)
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}
