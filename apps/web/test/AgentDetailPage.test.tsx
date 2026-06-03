import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'

// The page reads route params, renders <Link>s and navigates; stub the router so we can mount
// it without a full RouterProvider. Must run before the component is imported.
const navCalls: unknown[] = []
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => (args: unknown) => navCalls.push(args),
  useParams: () => ({ orgId: 'org1', agentId: 'a1' }),
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}))

const { AgentDetailPage } = await import('../src/features/orgs/AgentDetailPage.tsx')

const ISO = '2026-06-02T00:00:00.000Z'
const AGENT = {
  id: 'a1',
  organizationId: 'org1',
  name: 'my-agent',
  keyPrefix: 'wln_agt_pub',
  scopes: ['db:read', 'db:write'],
  createdAt: ISO,
  grants: [
    {
      id: 'g1',
      resourceType: 'project',
      resourceId: 'p1',
      resourceName: 'My project',
      scopes: [
        { scope: 'db:read', expiresAt: null },
        { scope: 'db:write', expiresAt: null },
      ],
    },
  ],
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  navCalls.length = 0
})

const ROTATED_KEY = 'wln_agt_rotated_999'

/** Stub the API and record every mutating call so tests can assert what the UI hit. `agent`
 * overrides the detail payload (e.g. an agent with no grants for the empty state). */
function stubApi(agent: typeof AGENT = AGENT): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/rotate-key')) {
      calls.push({ url, method })
      return json({ ...agent, apiKey: ROTATED_KEY })
    }
    if (method !== 'GET') {
      calls.push({ url, method })
      return json({ revoked: true })
    }
    if (url.includes('/api/agents/a1')) {
      return json(agent)
    }
    return json({})
  }) as typeof fetch
  return { calls }
}

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AgentDetailPage />
    </QueryClientProvider>,
  )
}

describe('AgentDetailPage', () => {
  test('renders the grant with scope descriptions and revokes a single scope', async () => {
    const { calls } = stubApi()
    mount()

    // The grant's resource and a human description of each scope render.
    expect(await screen.findByText('My project')).toBeDefined()
    expect(screen.getByText(/Insert, update and copy rows/)).toBeDefined() // db:write description

    // Revoke just db:write (its button is titled distinctly so it's unambiguous).
    fireEvent.click(screen.getByTitle('Revoke Write (db:write)'))
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toContain('/api/agents/a1/grants/g1/scopes/')
    expect(decodeURIComponent(calls[0]?.url ?? '')).toContain('scopes/db:write')
  })

  test('revoke-all confirms then deletes the whole grant', async () => {
    const { calls } = stubApi()
    mount()
    await screen.findByText('My project')

    // Open the confirm dialog (card button), then confirm in the dialog footer.
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    expect(await screen.findByText('Revoke all access?')).toBeDefined()
    const confirmButtons = screen.getAllByRole('button', { name: 'Revoke all' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1] as HTMLElement)

    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toMatch(/\/api\/agents\/a1\/grants\/g1$/)
  })

  test('shows the empty state when the agent holds no grants', async () => {
    stubApi({ ...AGENT, grants: [] })
    mount()
    expect(await screen.findByText('No access yet')).toBeDefined()
    // The danger zone is still available for a grant-less agent.
    expect(screen.getByRole('button', { name: 'Rotate key' })).toBeDefined()
  })

  test('rotate key POSTs and reveals the new one-time key', async () => {
    const { calls } = stubApi()
    mount()
    await screen.findByText('My project')

    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    expect(await screen.findByText(ROTATED_KEY)).toBeDefined()
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/rotate-key'))).toBe(true)
  })

  test('delete agent confirms, calls DELETE, and navigates back to the roster', async () => {
    const { calls } = stubApi()
    mount()
    await screen.findByText('My project')

    fireEvent.click(screen.getByRole('button', { name: /Delete agent/ }))
    expect(await screen.findByText('Delete agent?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toMatch(/\/api\/agents\/a1$/)
    await waitFor(() => expect(navCalls.length).toBe(1))
    expect(navCalls[0]).toMatchObject({ to: '/orgs/$orgId/agents', params: { orgId: 'org1' } })
  })
})
