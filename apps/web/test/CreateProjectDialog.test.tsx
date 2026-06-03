import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { CreateProjectDialog } from '../src/features/orgs/CreateProjectDialog.tsx'

const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function renderDialog(onClose: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CreateProjectDialog orgId="org1" open onClose={onClose} />
    </QueryClientProvider>,
  )
}

describe('CreateProjectDialog', () => {
  test('posts to the org projects endpoint with the entered name, then closes', async () => {
    const calls: { url: string; method: string; body: string }[] = []
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
      if (url.includes('/api/organizations/') && (init?.method ?? '').toUpperCase() === 'POST') {
        calls.push({ url, method: (init?.method ?? '').toUpperCase(), body: String(init?.body ?? '') })
        return new Response(
          JSON.stringify({
            id: 'p1',
            organizationId: 'org1',
            name: 'analytics',
            status: 'active',
            provider: 'local',
            region: null,
            defaultBranch: 'main',
            createdAt: '2026-01-01T00:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    let closed = false
    renderDialog(() => {
      closed = true
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. analytics'), { target: { value: 'analytics' } })
    fireEvent.click(screen.getByText('Create project'))

    // On success it closes the dialog…
    await waitFor(() => expect(closed).toBe(true))
    // …after POSTing to the org's projects endpoint with the entered name.
    expect(calls[0]?.url).toContain('/api/organizations/org1/projects')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toContain('analytics')
  })

  test('surfaces a server error and stays on the form', async () => {
    globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
      if (url.includes('/api/organizations/') && (init?.method ?? '').toUpperCase() === 'POST') {
        return new Response(
          JSON.stringify({ error: 'internal_error', message: 'Failed to create a project.' }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    let closed = false
    renderDialog(() => {
      closed = true
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. analytics'), { target: { value: 'late-project' } })
    fireEvent.click(screen.getByText('Create project'))

    expect(await screen.findByText(/failed to create a project/i)).toBeDefined()
    // Still on the form, and the dialog did not close.
    expect(screen.getByPlaceholderText('e.g. analytics')).toBeDefined()
    expect(closed).toBe(false)
  })
})
