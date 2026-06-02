import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { CreateAgentDialog } from '../src/features/orgs/CreateAgentDialog.tsx'
import { getAgentKey } from '../src/lib/agentKeys.ts'

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  localStorage.clear()
})

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CreateAgentDialog orgId="org1" open onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('CreateAgentDialog', () => {
  test('posts to the org agents endpoint, reveals the key once, and stores it', async () => {
    const calls: { url: string; method: string; body: string }[] = []
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
      if (url.includes('/api/organizations/') && (init?.method ?? '').toUpperCase() === 'POST') {
        calls.push({ url, method: (init?.method ?? '').toUpperCase(), body: String(init?.body ?? '') })
        return new Response(
          JSON.stringify({
            id: 'a1',
            organizationId: 'org1',
            name: 'claude-code',
            keyPrefix: 'wln_agt_abc',
            scopes: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            apiKey: 'wln_agt_secret_value',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('e.g. claude-code'), { target: { value: 'claude-code' } })
    fireEvent.click(screen.getByText('Create agent'))

    // The one-time key surfaces in the reveal step.
    expect(await screen.findByText('wln_agt_secret_value')).toBeDefined()
    // It hit the org's agents endpoint with the entered name (agents are org-scoped now).
    expect(calls[0]?.url).toContain('/api/organizations/org1/agents')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toContain('claude-code')
    // And it was stashed for the (future) console.
    expect(getAgentKey(localStorage, 'a1')).toBe('wln_agt_secret_value')
  })

  test('surfaces a server error and does not reveal a key', async () => {
    globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
      if (url.includes('/api/organizations/') && (init?.method ?? '').toUpperCase() === 'POST') {
        return new Response(
          JSON.stringify({ error: 'internal_error', message: 'Failed to create an agent.' }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('e.g. claude-code'), { target: { value: 'late-bot' } })
    fireEvent.click(screen.getByText('Create agent'))

    expect(await screen.findByText(/failed to create an agent/i)).toBeDefined()
    // Still on the form (no key revealed).
    expect(screen.getByPlaceholderText('e.g. claude-code')).toBeDefined()
  })
})
