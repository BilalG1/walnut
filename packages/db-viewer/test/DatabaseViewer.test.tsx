import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { DatabaseViewer } from '../src/index.ts'
import type {
  AdapterCapabilities,
  CellValue,
  ColumnMeta,
  DatabaseViewerAdapter,
  RowsRequest,
  RowsResult,
  TableRef,
} from '../src/types.ts'

afterEach(cleanup)

const CAPS: AdapterCapabilities = {
  cursor: false,
  totalCount: true,
  filters: true,
  rawSql: false,
  mutate: false,
  schemas: ['public'],
}

function meta(name: string, kind: ColumnMeta['kind'], extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, kind, udtName: kind, nullable: true, isPrimaryKey: false, default: null, references: null, ...extra }
}

const COLUMNS: ColumnMeta[] = [
  meta('id', 'bigint', { isPrimaryKey: true, nullable: false, udtName: 'int8' }),
  meta('name', 'text'),
  meta('bio', 'text'),
]

const TABLES: TableRef[] = [
  { schema: 'public', name: 'users', kind: 'table', estimatedRows: 1234 },
  { schema: 'public', name: 'orders', kind: 'table', estimatedRows: 5 },
]

// Two rows that exercise NULL-vs-empty-string: row 1 has a NULL bio, row 2 has an empty-string name.
const ROWS: CellValue[][] = [
  [{ k: 'bigint', v: '1' }, { k: 'text', v: 'alice' }, { k: 'null' }],
  [{ k: 'bigint', v: '2' }, { k: 'text', v: '' }, { k: 'text', v: 'hello' }],
]

interface Fake {
  adapter: DatabaseViewerAdapter
  requests: RowsRequest[]
}

function fakeAdapter(getRows: (req: RowsRequest) => RowsResult, tables: TableRef[] = TABLES): Fake {
  const requests: RowsRequest[] = []
  const adapter: DatabaseViewerAdapter = {
    capabilities: CAPS,
    listTables: async () => tables,
    getColumns: async () => COLUMNS,
    getRows: async (req) => {
      requests.push(req)
      return getRows(req)
    },
  }
  return { adapter, requests }
}

const TWO_ROWS = (): RowsResult => ({ columns: COLUMNS, rows: ROWS, page: { total: 2, hasNext: false, hasPrev: false } })

describe('DatabaseViewer', () => {
  test('lists tables, auto-selects the first, and renders its rows', async () => {
    const { adapter } = fakeAdapter(TWO_ROWS)
    render(<DatabaseViewer adapter={adapter} />)

    expect(await screen.findByText('alice')).toBeDefined()
    // Headers
    expect(screen.getByRole('columnheader', { name: /name/ })).toBeDefined()
    // Both tables show in the sidebar
    expect(screen.getByRole('button', { name: /orders/ })).toBeDefined()
  })

  test('renders NULL distinctly and does not render an empty string as NULL', async () => {
    const { adapter } = fakeAdapter(TWO_ROWS)
    render(<DatabaseViewer adapter={adapter} />)
    await screen.findByText('alice')

    // Exactly one NULL on screen (the bio of row 1), not the empty-string name of row 2.
    const nulls = screen.getAllByText('NULL')
    expect(nulls).toHaveLength(1)
    expect(nulls[0]?.className).toContain('wdv-null')
  })

  test('clicking a header sorts that column and reflects aria-sort', async () => {
    const { adapter, requests } = fakeAdapter(TWO_ROWS)
    render(<DatabaseViewer adapter={adapter} />)
    await screen.findByText('alice')

    const before = requests.length
    fireEvent.click(screen.getByRole('button', { name: 'name' }))

    await waitFor(() => expect(requests.length).toBeGreaterThan(before))
    expect(requests.at(-1)?.sort).toEqual([{ column: 'name', direction: 'asc' }])

    const header = screen.getByRole('columnheader', { name: /name/ })
    await waitFor(() => expect(header.getAttribute('aria-sort')).toBe('ascending'))
  })

  test('pagination advances the offset and disables at boundaries', async () => {
    const { adapter, requests } = fakeAdapter((req) => {
      const offset = req.page.kind === 'offset' ? req.page.offset : 0
      return { columns: COLUMNS, rows: ROWS, page: { total: 100, hasNext: offset === 0, hasPrev: offset > 0 } }
    })
    render(<DatabaseViewer adapter={adapter} pageSize={50} />)
    await screen.findByText('alice')

    const prev = screen.getByRole('button', { name: 'Prev' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect((prev as HTMLButtonElement).disabled).toBe(true)
    expect((next as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(next)
    await waitFor(() => expect(requests.at(-1)?.page).toMatchObject({ kind: 'offset', offset: 50 }))
    // At offset 50, hasNext is false → Next disables, Prev enables.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('filtering the sidebar narrows the table list', async () => {
    const { adapter } = fakeAdapter(TWO_ROWS)
    render(<DatabaseViewer adapter={adapter} />)
    await screen.findByText('alice')

    expect(screen.getByRole('button', { name: /orders/ })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Filter tables'), { target: { value: 'user' } })
    expect(screen.queryByRole('button', { name: /orders/ })).toBeNull()
    expect(screen.getByRole('button', { name: /users/ })).toBeDefined()
  })

  test('shows the empty state for a table with no rows', async () => {
    const { adapter } = fakeAdapter(() => ({ columns: COLUMNS, rows: [], page: { total: 0, hasNext: false, hasPrev: false } }))
    render(<DatabaseViewer adapter={adapter} />)
    expect(await screen.findByText('No rows')).toBeDefined()
  })

  test('honors classNames overrides (tier 2)', async () => {
    const { adapter } = fakeAdapter(TWO_ROWS)
    const { container } = render(
      <DatabaseViewer adapter={adapter} classNames={{ root: 'host-root', table: 'host-table' }} />,
    )
    await screen.findByText('alice')
    expect(container.querySelector('.host-root')).not.toBeNull()
    expect(container.querySelector('.host-table')).not.toBeNull()
  })

  test('honors components injection (tier 3)', async () => {
    const { adapter } = fakeAdapter(() => ({ columns: COLUMNS, rows: [], page: { total: 0, hasNext: false, hasPrev: false } }))
    render(
      <DatabaseViewer
        adapter={adapter}
        components={{ Empty: ({ title }) => <div>CUSTOM-EMPTY:{title}</div> }}
      />,
    )
    expect(await screen.findByText('CUSTOM-EMPTY:No rows')).toBeDefined()
  })

  test('honors renderCell override (tier 4)', async () => {
    const { adapter } = fakeAdapter(TWO_ROWS)
    render(<DatabaseViewer adapter={adapter} renderCell={(cell) => <span>kind:{cell.k}</span>} />)
    await waitFor(() => expect(screen.getAllByText(/kind:/).length).toBeGreaterThan(0))
    // The null cell now routes through renderCell too, so no default "NULL" remains.
    expect(screen.queryByText('NULL')).toBeNull()
    expect(screen.getAllByText('kind:bigint').length).toBe(2)
  })

  test('surfaces a load error', async () => {
    const adapter: DatabaseViewerAdapter = {
      capabilities: CAPS,
      listTables: async () => TABLES,
      getColumns: async () => COLUMNS,
      getRows: async () => {
        throw new Error('permission denied for table users')
      },
    }
    render(<DatabaseViewer adapter={adapter} />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/permission denied/)).toBeDefined()
  })
})
