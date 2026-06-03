import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { Cell } from '../src/ui/Cell.tsx'
import type { CellValue, ColumnMeta } from '../src/types.ts'

afterEach(cleanup)

const COL: ColumnMeta = {
  name: 'c',
  kind: 'text',
  udtName: 'text',
  nullable: true,
  isPrimaryKey: false,
  default: null,
  references: null,
}

const longText = (ch: string): CellValue => ({ k: 'text', v: ch.repeat(120) })

describe('Cell', () => {
  test('renders NULL with the distinct class', () => {
    render(<Cell value={{ k: 'null' }} column={COL} />)
    expect(screen.getByText('NULL').className).toContain('wdv-null')
  })

  test('a long value expands and collapses', () => {
    render(<Cell value={longText('x')} column={COL} />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  test('collapses when the value changes (no stale expansion leaking across rows)', () => {
    const { rerender } = render(<Cell value={longText('a')} column={COL} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')

    // The grid reuses this Cell instance for a different row's value (positional keys). The new
    // value must render collapsed — not inherit the previous row's expanded state.
    rerender(<Cell value={longText('b')} column={COL} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  test('a short value is not expandable', () => {
    render(<Cell value={{ k: 'text', v: 'short' }} column={COL} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('short')).toBeDefined()
  })

  test('renderCell override bypasses the default rendering', () => {
    render(<Cell value={{ k: 'num', v: 5 }} column={COL} render={(cell) => <span>kind:{cell.k}</span>} />)
    expect(screen.getByText('kind:num')).toBeDefined()
  })
})
