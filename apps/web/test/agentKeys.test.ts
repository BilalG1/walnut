import { describe, expect, test } from 'bun:test'
import { getAgentKey, type KeyStore, loadAgentKeys, saveAgentKey } from '../src/lib/agentKeys.ts'

function fakeStore(): KeyStore {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
}

describe('agentKeys', () => {
  test('saves and reads keys per agent', () => {
    const store = fakeStore()
    expect(loadAgentKeys(store)).toEqual({})

    saveAgentKey(store, 'agent-1', 'wln_agt_aaa')
    saveAgentKey(store, 'agent-2', 'wln_agt_bbb')

    expect(getAgentKey(store, 'agent-1')).toBe('wln_agt_aaa')
    expect(getAgentKey(store, 'agent-2')).toBe('wln_agt_bbb')
    expect(getAgentKey(store, 'missing')).toBeUndefined()
  })

  test('recovers from corrupt storage', () => {
    const store = fakeStore()
    store.setItem('walnut.agentKeys', 'not-json{')
    expect(loadAgentKeys(store)).toEqual({})
  })
})
