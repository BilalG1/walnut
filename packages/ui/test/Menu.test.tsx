import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { Menu, MenuItem } from '../src/index.ts'

afterEach(cleanup)

describe('Menu', () => {
  test('is closed until the trigger is clicked', () => {
    render(
      <Menu trigger="Open">
        <MenuItem>Pick me</MenuItem>
      </Menu>,
    )
    expect(screen.queryByText('Pick me')).toBeNull()
    fireEvent.click(screen.getByText('Open'))
    expect(screen.getByText('Pick me')).toBeDefined()
  })

  test('selecting an item fires onSelect and closes the menu', () => {
    let selected = 0
    render(
      <Menu trigger="Open">
        <MenuItem onSelect={() => (selected += 1)}>Pick me</MenuItem>
      </Menu>,
    )
    fireEvent.click(screen.getByText('Open'))
    fireEvent.click(screen.getByText('Pick me'))
    expect(selected).toBe(1)
    expect(screen.queryByText('Pick me')).toBeNull()
  })
})
