import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'

// The page reads route params and navigates on leave; stub the router so we can mount it
// without a full RouterProvider. Must run before the component is imported.
const navCalls: unknown[] = []
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => (args: unknown) => navCalls.push(args),
  useParams: () => ({ orgId: 'org1' }),
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}))

const { SettingsPage } = await import('../src/features/orgs/SettingsPage.tsx')

const ISO = '2026-06-02T00:00:00.000Z'
const ME = { id: 'u1', email: 'me@example.com', onboardingCompletedAt: null }
const USAGE = {
  projects: { used: 2, limit: 10 },
  branches: { used: 20, limit: 25 },
  agents: { used: 1, limit: 25 },
}

type Org = { id: string; name: string; isPersonal: boolean; role: string; createdAt: string }
const MEMBER_ORG: Org = { id: 'org1', name: 'Acme Inc', isPersonal: false, role: 'member', createdAt: ISO }
const PERSONAL_ORG: Org = { id: 'org1', name: 'My Org', isPersonal: true, role: 'owner', createdAt: ISO }

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  navCalls.length = 0
})

/** Stub the API for the settings page and record every mutating call. `org` is the single org
 * the list returns (its `role` drives whether "Leave" shows). */
function stubApi(org: Org): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET') {
      calls.push({ url, method })
      return json({ removed: true })
    }
    if (url.includes('/usage')) return json(USAGE)
    if (url.includes('/api/me')) return json(ME)
    if (url.includes('/api/organizations')) return json([org])
    return json({})
  }) as typeof fetch
  return { calls }
}

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

describe('SettingsPage', () => {
  test('renders org identity and the usage bars', async () => {
    stubApi(MEMBER_ORG)
    mount()

    expect(await screen.findByText('Acme Inc')).toBeDefined()
    expect(screen.getByText('Shared')).toBeDefined() // shared-org type badge
    expect(screen.getByText('org1')).toBeDefined() // copyable org id

    // Each capped resource gets a usage row.
    expect(await screen.findByText('Projects')).toBeDefined()
    expect(screen.getByText('Branches')).toBeDefined()
    expect(screen.getByText('Agents')).toBeDefined()
  })

  test('a non-owner can leave: confirms, DELETEs their membership, and navigates home', async () => {
    const { calls } = stubApi(MEMBER_ORG)
    mount()
    await screen.findByText('Acme Inc')

    // Open the confirm dialog from the danger-zone button, then confirm in the footer.
    fireEvent.click(screen.getByRole('button', { name: /Leave organization/ }))
    expect(await screen.findByText('Leave organization?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toMatch(/\/api\/organizations\/org1\/members\/u1$/)
    await waitFor(() => expect(navCalls.length).toBe(1))
    expect(navCalls[0]).toMatchObject({ to: '/' })
  })

  test('an owner sees no leave affordance (personal org)', async () => {
    stubApi(PERSONAL_ORG)
    mount()

    expect(await screen.findByText('My Org')).toBeDefined()
    expect(screen.getByText('Personal')).toBeDefined()
    // Owners can't leave — the danger zone is absent.
    expect(screen.queryByRole('button', { name: /Leave organization/ })).toBeNull()
  })
})
