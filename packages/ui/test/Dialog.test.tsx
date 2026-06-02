import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { Dialog } from '../src/index.ts'

afterEach(cleanup)

describe('Dialog', () => {
  test('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={() => {}}>
        Body
      </Dialog>,
    )
    expect(screen.queryByText('Body')).toBeNull()
  })

  test('shows content when open and closes on overlay click', () => {
    let closed = 0
    render(
      <Dialog open title="Confirm" onClose={() => (closed += 1)}>
        Body
      </Dialog>,
    )
    expect(screen.getByText('Body')).toBeDefined()
    expect(screen.getByText('Confirm')).toBeDefined()
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(closed).toBe(1)
  })
})
