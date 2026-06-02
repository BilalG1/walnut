import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { Check, createIcon } from '../src/index.ts'

afterEach(cleanup)

describe('icons', () => {
  test('renders an svg sized by the size prop, hidden from a11y by default', () => {
    const { container } = render(<Check size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('width')).toBe('32')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  test('a title makes the icon a labelled image', () => {
    const Dummy = createIcon('Dummy', [{ tag: 'path', attrs: { d: 'M0 0h24v24H0z' } }])
    expect(Dummy.displayName).toBe('Dummy')
    const { container } = render(<Dummy title="dummy" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.getAttribute('aria-label')).toBe('dummy')
    expect(container.querySelector('path')).not.toBeNull()
  })
})
