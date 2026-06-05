import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { baseName, formatBytes, isImage, typeLabel, type StorageObject } from '../src/features/projects/storage/common.tsx'
import { TableView } from '../src/features/projects/storage/TableView.tsx'

afterEach(cleanup)

const objects: StorageObject[] = [
  { path: 'images/cat.png', size: 2048, contentType: 'image/png', etag: null },
  { path: 'images/dog.jpg', size: 4096, contentType: 'image/jpeg', etag: null },
  { path: 'readme.txt', size: 12, contentType: 'text/plain', etag: null },
]

const ctx = { projectId: 'p1', branch: 'main', objects, onDelete: () => {}, deleting: null }

describe('storage helpers', () => {
  test('formatBytes scales units', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  test('baseName / isImage / typeLabel', () => {
    expect(baseName('a/b/c.png')).toBe('c.png')
    expect(baseName('flat')).toBe('flat')
    expect(isImage('image/png')).toBe(true)
    expect(isImage('text/plain')).toBe(false)
    expect(isImage(null)).toBe(false)
    expect(typeLabel('image/png')).toBe('PNG')
    expect(typeLabel(null)).toBe('file')
  })
})

describe('TableView', () => {
  test('renders every object path and its size', () => {
    render(<TableView {...ctx} />)
    expect(screen.getByText('images/cat.png')).toBeDefined()
    expect(screen.getByText('readme.txt')).toBeDefined()
    expect(screen.getByText('2.0 KB')).toBeDefined()
  })
})
