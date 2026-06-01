import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { ScopeBadges } from '../src/components/ScopeBadges.tsx'

afterEach(cleanup)

describe('ScopeBadges', () => {
  test('renders a short label for each scope', () => {
    render(<ScopeBadges scopes={['db:read', 'db:ddl']} />)
    expect(screen.getByText('Read')).toBeDefined()
    expect(screen.getByText('Schema')).toBeDefined()
  })

  test('shows an empty state when there are no scopes', () => {
    render(<ScopeBadges scopes={[]} />)
    expect(screen.getByText('no scopes')).toBeDefined()
  })
})
