// --- The adapter contract (pure types; no React) ---
export type {
  AdapterCapabilities,
  CellValue,
  ColumnKind,
  ColumnMeta,
  ColumnReference,
  Cursor,
  DatabaseViewerAdapter,
  Filter,
  FilterInput,
  FilterOp,
  PageInfo,
  PageRequest,
  RowMutation,
  RowsRequest,
  RowsResult,
  SortSpec,
  TableKind,
  TableRef,
} from './types.ts'

// --- Headless core ---
export { useDatabaseViewer } from './core/useDatabaseViewer.ts'
export type { DatabaseViewerApi, UseDatabaseViewerOptions } from './core/useDatabaseViewer.ts'
export { formatCell, isNull } from './core/format.ts'
export { DEFAULT_PAGE_SIZE } from './core/paginate.ts'

// --- Default skin ---
export { DatabaseViewer } from './ui/DatabaseViewer.tsx'
export type { DatabaseViewerProps } from './ui/DatabaseViewer.tsx'
export type {
  EmptyProps,
  ErrorStateProps,
  RenderCell,
  RenderHeader,
  SpinnerProps,
  ViewerClassNames,
  ViewerComponents,
} from './ui/slots.ts'
