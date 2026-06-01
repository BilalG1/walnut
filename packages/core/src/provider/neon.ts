import type { DatabaseProvider } from './types.ts'

const NEON_API = 'https://console.neon.tech/api/v2'

interface NeonCreateProjectResponse {
  project: { id: string; region_id?: string }
  connection_uris?: { connection_uri: string }[]
}

/**
 * A provider backed by the real Neon API — one serverless Postgres project per
 * platform project. Scale-to-zero makes per-tenant databases economical, which
 * is the whole reason Neon sits underneath this MVP.
 */
export function createNeonProvider(apiKey: string): DatabaseProvider {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  return {
    kind: 'neon',
    async provision({ name }) {
      const res = await fetch(`${NEON_API}/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: { name } }),
      })
      if (!res.ok) {
        throw new Error(`Neon: failed to create project (${res.status}): ${await res.text()}`)
      }
      const data = (await res.json()) as NeonCreateProjectResponse
      const connectionUri = data.connection_uris?.[0]?.connection_uri
      if (connectionUri === undefined) {
        throw new Error('Neon: project created but no connection URI was returned')
      }
      return {
        providerProjectId: data.project.id,
        connectionUri,
        region: data.project.region_id ?? null,
      }
    },
    async destroy(providerProjectId) {
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
