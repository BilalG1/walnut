import type { CreateBranchInput, DatabaseProvider, DestroyBranchInput, ProvisionedDatabase } from './types.ts'

const NEON_API = 'https://console.neon.tech/api/v2'

interface NeonBranchPayload {
  project?: { id: string; region_id?: string }
  branch?: { id: string }
  connection_uris?: { connection_uri: string }[]
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

/**
 * A provider backed by the real Neon API — one Neon project per platform project, and one Neon
 * *branch* per platform branch. Neon's instant copy-on-write branching is the whole reason it
 * sits underneath this MVP: a branch is a cheap point-in-time clone of its parent with its own
 * compute endpoint and connection string. Scale-to-zero makes the per-branch databases economical.
 */
export function createNeonProvider(apiKey: string): DatabaseProvider {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  async function call(method: string, path: string, body?: unknown): Promise<NeonBranchPayload> {
    const res = await fetch(`${NEON_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Neon: ${method} ${path} failed (${res.status}): ${await res.text()}`)
    }
    return (await res.json()) as NeonBranchPayload
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
      const res = await fetch(
        `${NEON_API}/projects/${encodeURIComponent(providerProjectId)}/branches/${encodeURIComponent(providerBranchId)}`,
        { method: 'DELETE', headers },
      )
      if (!res.ok && res.status !== 404) {
        throw new Error(`Neon: failed to delete branch (${res.status}): ${await res.text()}`)
      }
    },
    async destroyProject(providerProjectId) {
      const res = await fetch(`${NEON_API}/projects/${encodeURIComponent(providerProjectId)}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`Neon: failed to delete project (${res.status}): ${await res.text()}`)
      }
    },
  }
}
