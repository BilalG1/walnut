import { GitBranch, HardDrive, Search, Upload } from '@walnut/icons'
import { Badge, Button, EmptyState, Input, Spinner } from '@walnut/ui'
import { useRef, useState } from 'react'
import { useScope } from '../../../app/useScope.ts'
import { useStorageDelete, useStorageObjects, useStorageUpload } from '../../../data/queries.ts'
import { PageContainer } from '../../../components/layout/PageContainer.tsx'
import { type StorageObject } from './common.tsx'
import { TableView } from './TableView.tsx'

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
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const objects: StorageObject[] = data?.objects ?? []
  const filtered = filter === '' ? objects : objects.filter((o) => o.path.includes(filter))

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

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
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
        ) : (
          <TableView {...ctx} />
        )}
      </div>
    </PageContainer>
  )
}
