import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { ReactNode } from 'react'

// ScopeBoundary reads the URL scope (useScope → useParams) and renders <Link>s; stub the router so
// we can mount it without a RouterProvider. `scope` is mutable per test. Must run before import.
let scope: { orgId?: string; projectId?: string; branch?: string } = {}
mock.module('@tanstack/react-router', () => ({
  useParams: () => scope,
  useNavigate: () => () => {},
  Link: ({ children, to }: { children: ReactNode; to?: string }) => <a data-to={to}>{children}</a>,
}))

const { ScopeBoundary } = await import('../src/components/layout/ScopeBoundary.tsx')

const ORGS = [{ id: 'org1', name: 'Org One', isPersonal: true, role: 'owner' }]
const BRANCHES = [
  { id: 'b1', name: 'main', isDefault: true, status: 'active', region: null },
  { id: 'b2', name: 'feature', isDefault: false, status: 'active', region: null },
]

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  scope = {}
})

function stubApi(): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    if (url.includes('/branches')) {
      return json(BRANCHES)
    }
    if (url.includes('/api/organizations')) {
      return json(ORGS)
    }
    return json({})
  }) as typeof fetch
}

function mount(node: ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe('ScopeBoundary', () => {
  test('organization not-found lists the user\'s orgs to switch to', async () => {
    stubApi()
    mount(<ScopeBoundary result={{ status: 'not-found', resource: 'organization' }} />)
    expect(screen.getByText('Organization not found')).toBeDefined()
    // The org link appears once the org list loads.
    const link = await waitFor(() => screen.getByText('Org One').closest('a'))
    expect(link?.getAttribute('data-to')).toBe('/orgs/$orgId')
  })

  test('project not-found offers a way back to the org\'s projects', () => {
    scope = { orgId: 'org1' }
    mount(<ScopeBoundary result={{ status: 'not-found', resource: 'project' }} />)
    expect(screen.getByText('Project not found')).toBeDefined()
    expect(screen.getByText('Back to projects').closest('a')?.getAttribute('data-to')).toBe('/orgs/$orgId')
  })

  test('branch not-found names the missing branch and links to the default + siblings', async () => {
    stubApi()
    scope = { orgId: 'org1', projectId: 'p1', branch: 'ghost' }
    mount(<ScopeBoundary result={{ status: 'not-found', resource: 'branch' }} />)
    expect(screen.getByText('Branch not found')).toBeDefined()
    expect(screen.getByText('ghost')).toBeDefined() // the bad branch name is surfaced
    // Both real branches are offered to jump to.
    await waitFor(() => expect(screen.getByText('main')).toBeDefined())
    expect(screen.getByText('feature')).toBeDefined()
  })

  test('a genuine error shows a retry, not a "does not exist" message', () => {
    let retries = 0
    mount(<ScopeBoundary result={{ status: 'error', error: new Error('kaboom'), retry: () => retries++ }} />)
    expect(screen.getByText('Something went wrong')).toBeDefined()
    expect(screen.getByText('kaboom')).toBeDefined()
    fireEvent.click(screen.getByText('Try again'))
    expect(retries).toBe(1)
  })

  test('the loading state renders without crashing', () => {
    mount(<ScopeBoundary result={{ status: 'loading' }} />)
    // No heading — just the spinner; assert none of the terminal states leaked in.
    expect(screen.queryByText('Branch not found')).toBeNull()
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })
})
