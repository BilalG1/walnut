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

/** Stub the API. `agentKey` is a freshly-created agent's one-time key; `rotatedKey` is what
 * `rotate-key` returns (used by the resume path). A pending request for `a1` is always
 * available, so step 2 completes as soon as it's reached. */
function stubApi(agentKey: string, rotatedKey: string): void {
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/rotate-key')) {
      return json({ id: 'a1', organizationId: 'org1', name: 'my-agent', keyPrefix: 'wln_agt_pub', scopes: [], createdAt: ISO, apiKey: rotatedKey })
    }
    if (method === 'POST' && url.includes('/projects')) {
      return json({ id: 'p1', name: 'My project', provider: 'local', region: null, status: 'active', error: null, createdAt: ISO, connectionUri: null })
    }
    if (method === 'POST' && url.includes('/agents')) {
      return json({ id: 'a1', organizationId: 'org1', name: 'my-agent', keyPrefix: 'wln_agt_pub', scopes: [], createdAt: ISO, apiKey: agentKey })
    }
    if (method === 'POST' && url.includes('/onboarding/complete')) {
      return json({ id: 'u1', email: 'dev@walnut.cloud', onboardingCompletedAt: ISO })
    }
    if (method === 'GET' && url.includes('/requests')) {
      return json([{ id: 'req1', agentId: 'a1', organizationId: 'org1', resourceType: 'project', resourceId: 'p1', scopes: ['db:read'], reason: 'list tables', expiresInSeconds: null, status: 'pending', createdAt: ISO, resolvedAt: null }])
    }
    return json({})
  }) as typeof fetch
}

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <GetStartedPage />
    </QueryClientProvider>,
  )
}

describe('GetStartedPage', () => {
  test('create project → auto-connect agent → first request arrives and hands off to Requests', async () => {
    stubApi('wln_agt_secret123', 'wln_agt_rotated999')
    mount()

    // Step 0 — create project (name is prefilled, no agent-name prompt anywhere). Target the
    // button by role since "Create project" also appears as the stepper label.
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('My project')
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    // Step 1 — the agent is auto-created (no name input) and the install + login commands
    // appear. The login command carries --api-url because the dev API isn't the default.
    expect(await screen.findByText(/walnut login --api-key wln_agt_secret123 --api-url/)).toBeDefined()
    expect(screen.getByText(/curl -fsSL .*\/install \| sh/)).toBeDefined()
    // The removed affordances stay removed.
    expect(screen.queryByText(/won.t be shown again/)).toBeNull()
    expect(screen.queryByText(/walnut whoami/)).toBeNull()
    fireEvent.click(screen.getByText('Continue'))

    // Step 2 — the polled request arrives; onboarding completes and we point at Requests.
    expect(await screen.findByText('Review request')).toBeDefined()
    expect(screen.getByText(/asking for access/)).toBeDefined()
  })

  test('resumes from saved progress and rotates a fresh key (never reads a stored secret)', async () => {
    stubApi('wln_agt_secret123', 'wln_agt_rotated999')
    localStorage.setItem(
      'walnut.onboarding',
      JSON.stringify({ orgId: 'org1', step: 1, projectId: 'p1', projectName: 'My project', agentId: 'a1', agentName: 'my-agent' }),
    )
    mount()

    // Lands on step 1 and shows a rotated key (the original was never persisted client-side).
    expect(await screen.findByText(/walnut login --api-key wln_agt_rotated999/)).toBeDefined()
  })
})
