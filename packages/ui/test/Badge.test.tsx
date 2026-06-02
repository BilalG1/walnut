import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { Badge } from '../src/index.ts'

afterEach(cleanup)

describe('Badge', () => {
  test('renders content with the chosen tone', () => {
    render(<Badge tone="emerald">active</Badge>)
    expect(screen.getByText('active').className).toContain('text-emerald-300')
  })

  test('adds a mono class when requested', () => {
    render(<Badge mono>db:read</Badge>)
    expect(screen.getByText('db:read').className).toContain('font-mono')
  })
})
