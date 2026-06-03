import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'

// The page reads the :token param and navigates on accept; stub the router so we can mount it
// without a RouterProvider. Must run before the component is imported.
const navCalls: unknown[] = []
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => (args: unknown) => navCalls.push(args),
  useParams: () => ({ token: 'tok1' }),
}))

const { AcceptInvitePage } = await import('../src/features/AcceptInvitePage.tsx')

const VALID = {
  organizationId: 'org-9',
  organizationName: 'Acme Inc',
  role: 'member',
  state: 'valid',
  alreadyMember: false,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  navCalls.length = 0
})

/** Stub the preview GET and accept POST. `preview` is the GET payload; `previewStatus` lets a test
 * return a 404 for an invalid token. The accept POST always returns the joined org. */
function stubApi(preview: unknown, previewStatus = 200): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/accept')) {
      calls.push({ url, method })
      return json({ organizationId: 'org-9' })
    }
    calls.push({ url, method })
    return previewStatus === 200 ? json(preview) : json({ error: 'not_found', message: 'Invitation not found.' }, previewStatus)
  }) as typeof fetch
  return { calls }
}

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AcceptInvitePage />
    </QueryClientProvider>,
  )
}

describe('AcceptInvitePage', () => {
  test('shows a valid invite, then accepting joins the org and navigates into it', async () => {
    const { calls } = stubApi(VALID)
    mount()

    expect(await screen.findByText('Acme Inc')).toBeDefined()
    expect(screen.getByText(/invited to join/i)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/accept'))).toBe(true))
    await waitFor(() => expect(navCalls.length).toBeGreaterThan(0))
    expect(navCalls.at(-1)).toMatchObject({ to: '/orgs/$orgId', params: { orgId: 'org-9' } })
  })

  test('shows already-a-member with a go-to-org action', async () => {
    stubApi({ ...VALID, alreadyMember: true })
    mount()

    expect(await screen.findByText(/already a member/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Go to organization' }))
    await waitFor(() => expect(navCalls.length).toBeGreaterThan(0))
    expect(navCalls.at(-1)).toMatchObject({ to: '/orgs/$orgId', params: { orgId: 'org-9' } })
  })

  test('shows an expired invite as unavailable', async () => {
    stubApi({ ...VALID, state: 'expired' })
    mount()

    expect(await screen.findByText('Invite unavailable')).toBeDefined()
    expect(screen.getByText(/has expired/i)).toBeDefined()
  })

  test('shows an unknown token as an invalid link', async () => {
    stubApi(null, 404)
    mount()

    expect(await screen.findByText('Invite unavailable')).toBeDefined()
    expect(screen.getByText(/invalid/i)).toBeDefined()
  })
})
