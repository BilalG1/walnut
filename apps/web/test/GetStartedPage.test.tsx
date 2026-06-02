import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'

// The page reads route params (org scope) and navigates; stub the router so we can mount
// it without a full RouterProvider. Must run before the component is imported.
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => () => {},
  useParams: () => ({ orgId: 'org1' }),
}))

const { GetStartedPage } = await import('../src/features/orgs/GetStartedPage.tsx')

const ISO = '2026-06-02T00:00:00.000Z'
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  localStorage.clear()
})

function mountWithApi(): void {
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/projects')) {
      return json({ id: 'p1', name: 'My project', provider: 'local', region: null, status: 'active', error: null, createdAt: ISO, connectionUri: null })
    }
    if (method === 'POST' && url.includes('/agents')) {
      return json({ id: 'a1', organizationId: 'org1', name: 'my-agent', keyPrefix: 'wln_agt_pub', scopes: [], createdAt: ISO, apiKey: 'wln_agt_secret123' })
    }
    if (method === 'POST' && url.includes('/approve')) {
      return json({ id: 'req1', agentId: 'a1', organizationId: 'org1', resourceType: 'project', resourceId: 'p1', scopes: ['db:read'], reason: 'list tables', status: 'approved', createdAt: ISO, resolvedAt: ISO })
    }
    if (method === 'GET' && url.includes('/requests')) {
      return json([{ id: 'req1', agentId: 'a1', organizationId: 'org1', resourceType: 'project', resourceId: 'p1', scopes: ['db:read'], reason: 'list tables', status: 'pending', createdAt: ISO, resolvedAt: null }])
    }
    return json({})
  }) as typeof fetch

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <GetStartedPage />
    </QueryClientProvider>,
  )
}

describe('GetStartedPage', () => {
  test('walks create → connect → grant and approves the agent\'s first request', async () => {
    mountWithApi()

    // Step 1 — create project (name is prefilled).
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('My project')
    fireEvent.click(screen.getByText('Create project'))

    // Step 2 — connect agent, reveal the one-time key.
    fireEvent.click(await screen.findByText('Create agent & reveal key'))
    expect(await screen.findByText('wln_agt_secret123')).toBeDefined()
    fireEvent.click(screen.getByText('Continue'))

    // Step 3 — the polled pending request arrives; approve it.
    fireEvent.click(await screen.findByText('Approve'))
    expect(await screen.findByText(/granted your first scope/)).toBeDefined()
  })
})
