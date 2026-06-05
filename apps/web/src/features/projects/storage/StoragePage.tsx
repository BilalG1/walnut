import { GitBranch, HardDrive, Search, Upload } from '@walnut/icons'
import { Badge, Button, cn, EmptyState, Input, Spinner } from '@walnut/ui'
import { useRef, useState } from 'react'
import { useScope } from '../../../app/useScope.ts'
import { useStorageDelete, useStorageObjects, useStorageUpload } from '../../../data/queries.ts'
import { PageContainer } from '../../../components/layout/PageContainer.tsx'
import { type StorageObject, type StorageView, formatBytes } from './common.tsx'
import { ExplorerView } from './ExplorerView.tsx'
import { GalleryView } from './GalleryView.tsx'
import { TableView } from './TableView.tsx'

const VIEWS: { id: StorageView; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'gallery', label: 'Gallery' },
]

export function StoragePage() {
  const { projectId, branch } = useScope()
  if (projectId === undefined) {
    return null
  }
  return <StorageBrowser projectId={projectId} branch={branch ?? 'main'} />
}

function StorageBrowser({ projectId, branch }: { projectId: string; branch: string }) {
  const { data, isPending, error } = useStorageObjects(projectId, branch)
  const upload = useStorageUpload(projectId, branch)
  const del = useStorageDelete(projectId, branch)
  const [view, setView] = useState<StorageView>('table')
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const objects: StorageObject[] = data?.objects ?? []
  const filtered = filter === '' ? objects : objects.filter((o) => o.path.includes(filter))
  const totalBytes = objects.reduce((sum, o) => sum + o.size, 0)

  function onDelete(path: string): void {
    setDeleting(path)
    del.mutate(path, { onSettled: () => setDeleting(null) })
  }

  function onPickFile(file: File | undefined): void {
    if (file === undefined) {
      return
    }
    upload.mutate({ file, path: file.name })
  }

  const ctx = { projectId, branch, objects: filtered, onDelete, deleting }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <HardDrive size={22} className="text-walnut-500" /> Storage
            </h1>
            <Badge tone="neutral">
              <GitBranch size={12} />
              {branch}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-subtle">
            {objects.length} object{objects.length === 1 ? '' : 's'} · {formatBytes(totalBytes)} · branched O(1) with
            the database
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              onPickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button variant="primary" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? <Spinner /> : <Upload size={15} />}
            Upload
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {/* View switcher — the three candidate layouts, switchable live. */}
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                'rounded-md px-3 py-1 text-[13px] font-medium transition-colors',
                view === v.id ? 'bg-walnut-500/15 text-accent' : 'text-muted hover:text-fg-secondary',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-subtle" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by path…"
            className="w-56 pl-8"
          />
        </div>
      </div>

      {upload.error !== null ? <p className="mt-3 text-sm text-danger">{upload.error.message}</p> : null}

      <div className="mt-4">
        {isPending ? (
          <Spinner />
        ) : error !== null ? (
          <p className="text-sm text-danger">{error.message}</p>
        ) : objects.length === 0 ? (
          <EmptyState
            title="No objects yet"
            hint="Upload a file, or have an agent write one with `walnut storage cp`."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" hint="No object path contains your filter." />
        ) : view === 'table' ? (
          <TableView {...ctx} />
        ) : view === 'explorer' ? (
          <ExplorerView {...ctx} />
        ) : (
          <GalleryView {...ctx} />
        )}
      </div>
    </PageContainer>
  )
}
