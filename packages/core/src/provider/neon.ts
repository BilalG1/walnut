import { classifyProviderStatus, ProviderError } from './errors.ts'
import { type RetryOptions, withRetry } from './retry.ts'
import type { CreateBranchInput, DatabaseProvider, DestroyBranchInput, ProvisionedDatabase } from './types.ts'

const NEON_API = 'https://console.neon.tech/api/v2'

interface NeonBranchPayload {
  project?: { id: string; region_id?: string }
  branch?: { id: string }
  connection_uris?: { connection_uri: string }[]
}

/** Test seams: inject a fake `fetch` to drive the provider without a network, and tighten the
 * retry schedule (no real sleeping) for deterministic, instant tests. Production passes neither. */
export interface NeonProviderOptions {
  fetch?: typeof fetch
  retry?: RetryOptions
}

function databaseFrom(data: NeonBranchPayload, region: string | null): ProvisionedDatabase {
  const branchId = data.branch?.id
  const connectionUri = data.connection_uris?.[0]?.connection_uri
  if (branchId === undefined) {
    throw new Error('Neon: response had no branch id')
  }
  if (connectionUri === undefined) {
    throw new Error('Neon: branch created but no connection URI was returned')
  }
  return { providerBranchId: branchId, connectionUri, region }
}

const isRetryable = (err: unknown): boolean => err instanceof ProviderError && err.retryable

/**
 * A provider backed by the real Neon API — one Neon project per platform project, and one Neon
 * *branch* per platform branch. Neon's instant copy-on-write branching is the whole reason it
 * sits underneath this MVP: a branch is a cheap point-in-time clone of its parent with its own
 * compute endpoint and connection string. Scale-to-zero makes the per-branch databases economical.
 *
 * Every call goes through {@link withRetry}: transient failures (HTTP 429 / 5xx / a dropped
 * request) are retried with jittered backoff, while a 4xx we caused — or the shared account
 * hitting its own quota — fails fast as a classified {@link ProviderError} the service layer can
 * turn into the right HTTP response. Without this, a single Neon blip would hard-fail provisioning
 * and leak a half-created resource.
 */
export function createNeonProvider(apiKey: string, options: NeonProviderOptions = {}): DatabaseProvider {
  const fetchImpl = options.fetch ?? fetch
  const retry = options.retry
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  /** One fetch attempt, normalized to throw a classified {@link ProviderError} on any failure
   * (including a network error, where there's no HTTP status). */
  async function attempt(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response
    try {
      res = await fetchImpl(`${NEON_API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new ProviderError(`Neon: ${method} ${path} request failed`, { reason: 'unavailable', cause: err })
    }
    return res
  }

  /** A JSON call (POST/GET) with retries; returns the parsed body or throws a ProviderError. */
  async function call(method: string, path: string, body?: unknown): Promise<NeonBranchPayload> {
    return withRetry(
      async () => {
        const res = await attempt(method, path, body)
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw classifyProviderStatus(`Neon: ${method} ${path} failed (${res.status})`, res.status, text)
        }
        return (await res.json()) as NeonBranchPayload
      },
      isRetryable,
      retry,
    )
  }

  /** A DELETE with retries that treats 404 as success (the resource is already gone). */
  async function del(path: string, what: string): Promise<void> {
    await withRetry(
      async () => {
        const res = await attempt('DELETE', path)
        if (res.ok || res.status === 404) {
          return
        }
        const text = await res.text().catch(() => '')
        throw classifyProviderStatus(`Neon: failed to delete ${what} (${res.status})`, res.status, text)
      },
      isRetryable,
      retry,
    )
  }

  return {
    kind: 'neon',
    async provisionProject({ name }) {
      const data = await call('POST', '/projects', { project: { name } })
      const projectId = data.project?.id
      if (projectId === undefined) {
        throw new Error('Neon: project created but no project id was returned')
      }
      return {
        providerProjectId: projectId,
        defaultBranch: databaseFrom(data, data.project?.region_id ?? null),
      }
    },
    async createBranch({ providerProjectId, name, fromProviderBranchId }: CreateBranchInput) {
      if (providerProjectId === null) {
        throw new Error('Neon: createBranch requires a provider project id')
      }
      const branch: Record<string, unknown> = { name }
      if (fromProviderBranchId !== null) {
        branch.parent_id = fromProviderBranchId
      }
      // Request a read-write endpoint so the response carries a connection URI for the branch.
      const data = await call('POST', `/projects/${encodeURIComponent(providerProjectId)}/branches`, {
        branch,
        endpoints: [{ type: 'read_write' }],
      })
      return databaseFrom(data, null)
    },
    async destroyBranch({ providerProjectId, providerBranchId }: DestroyBranchInput) {
      if (providerProjectId === null) {
        throw new Error('Neon: destroyBranch requires a provider project id')
      }
      // This only ever targets non-default branches (the default branch goes with its project
      // via destroyProject), so anything other than success or "already gone" is a real error.
      await del(
        `/projects/${encodeURIComponent(providerProjectId)}/branches/${encodeURIComponent(providerBranchId)}`,
        'branch',
      )
    },
    async destroyProject(providerProjectId) {
      await del(`/projects/${encodeURIComponent(providerProjectId)}`, 'project')
    },
  }
}
