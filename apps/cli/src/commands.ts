import { type ApiClient, networkError, respond, statusOf } from './client.ts'
import { deleteCredentials, writeCredentials } from './credentials.ts'
import { EXIT } from './exit.ts'
import { fail, ok, type CliResult } from './output.ts'

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

/** `branch create <name> [--from <branch>]` → POST /agent/v1/branches. Forks a new branch from
 * `--from` (default: the project's main branch) in the target project. Needs the `branch:create`
 * scope; a 403 lists how to request it. Only sends the fields the user set, so the server applies
 * its own defaults (sole project, default source branch). */
export async function branchCreate(
  client: ApiClient,
  name: string,
  from: string | undefined,
  projectId: string | undefined,
  pretty: boolean,
): Promise<CliResult> {
  try {
    const body = {
      name,
      ...(from === undefined ? {} : { from }),
      ...(projectId === undefined ? {} : { projectId }),
    }
    const res = await client.agent.v1.branches.post(body)
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

// ─── storage ──────────────────────────────────────────────────────────────────────────────────
//
// `walnut storage` mirrors `db query`: same bearer auth, same project/branch defaulting, same
// scope-request 403 flow. Up/downloads go through presigned URLs, so the bytes stream directly
// between the client and the object store — never through the API. Agents name only `walnut://<path>`.

const WALNUT_SCHEME = 'walnut://'

/** Strip the `walnut://` scheme from an arg, or null if it isn't a remote path. */
function parseRemote(arg: string): string | null {
  return arg.startsWith(WALNUT_SCHEME) ? arg.slice(WALNUT_SCHEME.length) : null
}

/** Only send the project/branch fields the user actually set, so the server applies its defaults. */
function withTarget<T extends Record<string, unknown>>(base: T, target: Target): T {
  return {
    ...base,
    ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
    ...(target.branch === undefined ? {} : { branch: target.branch }),
  }
}

/** `storage ls [prefix]` → GET /agent/v1/storage/ls (the branch's effective view under a prefix). */
export async function storageLs(
  client: ApiClient,
  prefix: string | undefined,
  target: Target,
  pretty: boolean,
): Promise<CliResult> {
  try {
    const query = withTarget(prefix === undefined ? {} : { prefix }, target)
    const res = await client.agent.v1.storage.ls.get({ query })
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `storage stat <path>` → GET /agent/v1/storage/stat (metadata for one resolved object). */
export async function storageStat(client: ApiClient, path: string, target: Target, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.storage.stat.get({ query: withTarget({ path }, target) })
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `storage rm <path>` → POST /agent/v1/storage/delete (writes a tombstone on the branch). */
export async function storageRm(client: ApiClient, path: string, target: Target, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.storage.delete.post(withTarget({ path }, target))
    return respond(res, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `storage cat <path>` → download the object and write its bytes to stdout (text-oriented;
 * use `cp` for binary). */
export async function storageCat(client: ApiClient, path: string, target: Target, pretty: boolean): Promise<CliResult> {
  try {
    const res = await client.agent.v1.storage.download.get({ query: withTarget({ path }, target) })
    if (statusOf(res) !== 200) {
      return respond(res, pretty)
    }
    const url = (res.data as { url?: string } | null)?.url
    if (url === undefined) {
      return fail(EXIT.UNEXPECTED, 'no_download_url', 'The API returned no download URL.', pretty)
    }
    const got = await fetch(url)
    if (!got.ok) {
      return fail(EXIT.UNEXPECTED, 'download_failed', `Fetching the object failed with status ${got.status}.`, pretty)
    }
    return { stdout: await got.text(), stderr: '', code: EXIT.OK }
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** `storage cp <src> <dst>` — exactly one side is a `walnut://` path. Local → remote uploads
 * (content-addressed two-phase write); remote → local downloads via a presigned GET. */
export async function storageCp(
  client: ApiClient,
  source: string,
  dest: string,
  target: Target,
  pretty: boolean,
): Promise<CliResult> {
  const srcRemote = parseRemote(source)
  const dstRemote = parseRemote(dest)
  if (srcRemote === null && dstRemote !== null) {
    return uploadFile(client, source, dstRemote, target, pretty)
  }
  if (srcRemote !== null && dstRemote === null) {
    return downloadToFile(client, srcRemote, dest, target, pretty)
  }
  return fail(
    EXIT.USAGE,
    'usage',
    'cp needs exactly one walnut://<path> and one local path (e.g. `cp ./a.png walnut://img/a.png`).',
    pretty,
  )
}

/** Local → remote: hash the file, start the upload, PUT the bytes to the presigned URL (unless the
 * content already exists — a dedup hit commits immediately), then commit. */
async function uploadFile(
  client: ApiClient,
  localPath: string,
  remotePath: string,
  target: Target,
  pretty: boolean,
): Promise<CliResult> {
  const file = Bun.file(localPath)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return fail(EXIT.USAGE, 'usage', `Cannot read local file: ${localPath}`, pretty)
  }
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const contentType = file.type === '' ? undefined : file.type.split(';')[0]
  try {
    const started = await client.agent.v1.storage.upload.post(
      withTarget(
        { path: remotePath, sha256, size: bytes.byteLength, ...(contentType === undefined ? {} : { contentType }) },
        target,
      ),
    )
    if (statusOf(started) !== 200) {
      return respond(started, pretty)
    }
    const data = started.data as { status: string; url?: string } | null
    if (data?.status === 'committed') {
      return respond(started, pretty) // dedup hit — already stored, no upload needed
    }
    if (data?.url === undefined) {
      return fail(EXIT.UNEXPECTED, 'no_upload_url', 'The API returned no upload URL.', pretty)
    }
    const put = await fetch(data.url, { method: 'PUT', body: bytes })
    if (!put.ok) {
      return fail(EXIT.UNEXPECTED, 'upload_failed', `Uploading the object failed with status ${put.status}.`, pretty)
    }
    const committed = await client.agent.v1.storage.commit.post(withTarget({ path: remotePath }, target))
    return respond(committed, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}

/** Remote → local: resolve a presigned GET and stream the bytes to a local file. */
async function downloadToFile(
  client: ApiClient,
  remotePath: string,
  localPath: string,
  target: Target,
  pretty: boolean,
): Promise<CliResult> {
  try {
    const res = await client.agent.v1.storage.download.get({ query: withTarget({ path: remotePath }, target) })
    if (statusOf(res) !== 200) {
      return respond(res, pretty)
    }
    const url = (res.data as { url?: string } | null)?.url
    if (url === undefined) {
      return fail(EXIT.UNEXPECTED, 'no_download_url', 'The API returned no download URL.', pretty)
    }
    const got = await fetch(url)
    if (!got.ok) {
      return fail(EXIT.UNEXPECTED, 'download_failed', `Fetching the object failed with status ${got.status}.`, pretty)
    }
    const bytes = new Uint8Array(await got.arrayBuffer())
    await Bun.write(localPath, bytes)
    return ok({ downloaded: remotePath, to: localPath, bytes: bytes.byteLength }, pretty)
  } catch (err) {
    return networkError(err, pretty)
  }
}
