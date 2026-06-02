import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { Button } from '../src/index.ts'

afterEach(cleanup)

describe('Button', () => {
  test('renders its children and defaults to type=button', () => {
    render(<Button>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn.getAttribute('type')).toBe('button')
  })

  test('applies variant classes and keeps a custom className', () => {
    render(
      <Button variant="danger" className="custom-x">
        Delete
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn.className).toContain('custom-x')
    expect(btn.className).toContain('text-red-300')
  })
})
