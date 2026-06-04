import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'

// The guard reads the URL scope via useParams; stub the router so we can drive it without a
// RouterProvider. `scope` is mutable so each test sets the active org/project/branch. Must run
// before the modules under test are imported.
let scope: { orgId?: string; projectId?: string; branch?: string } = {}
mock.module('@tanstack/react-router', () => ({
  useParams: () => scope,
  useNavigate: () => () => {},
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}))

const { useScopeGuard } = await import('../src/app/useScopeGuard.ts')

const ORGS = [{ id: 'org1', name: 'Org One', isPersonal: true, role: 'owner' }]
const PROJECT = { id: 'p1', name: 'Proj', status: 'active', provider: 'local', connectionUri: 'postgres://x' }
const BRANCHES = [{ id: 'b1', name: 'main', isDefault: true, status: 'active', region: null }]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  scope = {}
})

/** Stub the three endpoints the guard touches. `branches` lets a test return a list that omits
 * the requested branch; project id `p1` exists, anything else is a 404. */
function stubApi(branches: typeof BRANCHES = BRANCHES): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    if (url.includes('/branches')) {
      return json(branches)
    }
    if (/\/api\/projects\/[^/]+$/.test(url)) {
      return url.includes('/api/projects/p1') ? json(PROJECT) : json({ error: 'not_found', message: 'x' }, 404)
    }
    if (url.includes('/api/organizations')) {
      return json(ORGS)
    }
    return json({})
  }) as typeof fetch
}

function Probe() {
  const result = useScopeGuard()
  const text = result.status === 'not-found' ? `not-found:${result.resource}` : result.status
  return <div data-testid="verdict">{text}</div>
}

async function verdict(): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  )
  // Wait for the queries to settle out of the initial 'loading' verdict.
  await waitFor(() => expect(screen.getByTestId('verdict').textContent).not.toBe('loading'))
  return screen.getByTestId('verdict').textContent ?? ''
}

describe('useScopeGuard', () => {
  test('no scope (e.g. landing/invite) is ok', async () => {
    stubApi()
    scope = {}
    expect(await verdict()).toBe('ok')
  })

  test('an org the user is not a member of is not-found (no API call needed)', async () => {
    stubApi()
    scope = { orgId: 'ghost' }
    expect(await verdict()).toBe('not-found:organization')
  })

  test('a member org with no project scope is ok', async () => {
    stubApi()
    scope = { orgId: 'org1' }
    expect(await verdict()).toBe('ok')
  })

  test('a valid org + project + existing branch is ok', async () => {
    stubApi()
    scope = { orgId: 'org1', projectId: 'p1', branch: 'main' }
    expect(await verdict()).toBe('ok')
  })

  test('a missing project (404) under a valid org is not-found:project', async () => {
    stubApi()
    scope = { orgId: 'org1', projectId: 'pX', branch: 'main' }
    expect(await verdict()).toBe('not-found:project')
  })

  test('a branch absent from the project is not-found:branch', async () => {
    stubApi(BRANCHES) // only has "main"
    scope = { orgId: 'org1', projectId: 'p1', branch: 'feature-x' }
    expect(await verdict()).toBe('not-found:branch')
  })
})
