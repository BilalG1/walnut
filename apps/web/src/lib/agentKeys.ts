/**
 * Dev-only client-side store for agent API keys. The backend returns an agent's
 * key exactly once at creation; we stash it in localStorage so the in-dashboard
 * agent console can act as that agent. Real auth will replace this later.
 */
export interface KeyStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'walnut.agentKeys'

export function loadAgentKeys(store: KeyStore): Record<string, string> {
  const raw = store.getItem(STORAGE_KEY)
  if (raw === null) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, string>
    }
    return {}
  } catch {
    return {}
  }
}

export function saveAgentKey(store: KeyStore, agentId: string, key: string): void {
  const all = loadAgentKeys(store)
  all[agentId] = key
  store.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function getAgentKey(store: KeyStore, agentId: string): string | undefined {
  return loadAgentKeys(store)[agentId]
}
