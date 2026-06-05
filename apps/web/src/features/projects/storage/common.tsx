import { Download, File as FileIcon, ImageIcon, Trash } from '@walnut/icons'
import { Button, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { fetchStorageDownload } from '../../../data/queries.ts'

/** A stored object as the dashboard storage routes return it (no physical key). */
export interface StorageObject {
  path: string
  size: number
  contentType: string | null
  etag: string | null
}

/** The three candidate layouts for the storage browser. Switched live so they can be compared. */
export type StorageView = 'table' | 'explorer' | 'gallery'

export interface ViewContext {
  projectId: string
  branch: string
  objects: StorageObject[]
  onDelete: (path: string) => void
  deleting: string | null
}

/** Human-readable byte size (1.0 KB, 3.4 MB, …). */
export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i] ?? 'TB'}`
}

/** The last path segment (the "file name"). */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function isImage(contentType: string | null): boolean {
  return contentType !== null && contentType.startsWith('image/')
}

/** A small label for a content type, e.g. `image/png` → `PNG`, else the subtype or `file`. */
export function typeLabel(contentType: string | null): string {
  if (contentType === null || contentType === '') {
    return 'file'
  }
  const sub = contentType.split('/')[1] ?? contentType
  return (sub.split(';')[0] ?? sub).toUpperCase()
}

/** Open an object via a freshly-minted short-TTL presigned GET (download / view in a new tab). */
async function openObject(projectId: string, branch: string, path: string): Promise<void> {
  const { url } = await fetchStorageDownload(projectId, branch, path)
  window.open(url, '_blank', 'noopener')
}

/** Download button — resolves a presigned URL on click and opens it. */
export function DownloadButton({ projectId, branch, path }: { projectId: string; branch: string; path: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="icon"
      variant="ghost"
      title="Download"
      aria-label={`Download ${baseName(path)}`}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void openObject(projectId, branch, path).finally(() => setBusy(false))
      }}
    >
      {busy ? <Spinner /> : <Download size={15} />}
    </Button>
  )
}

/** Delete (tombstone) button. */
export function DeleteButton({ path, onDelete, busy }: { path: string; onDelete: (p: string) => void; busy: boolean }) {
  return (
    <Button
      size="icon"
      variant="danger"
      title="Delete"
      aria-label={`Delete ${baseName(path)}`}
      disabled={busy}
      onClick={() => onDelete(path)}
    >
      {busy ? <Spinner /> : <Trash size={15} />}
    </Button>
  )
}

/** A lazily-loaded image thumbnail (gallery): fetches a presigned URL for image objects only. */
export function Thumb({ projectId, branch, object }: { projectId: string; branch: string; object: StorageObject }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  if (isImage(object.contentType) && url === null && !failed) {
    void fetchStorageDownload(projectId, branch, object.path)
      .then((d) => setUrl(d.url))
      .catch(() => setFailed(true))
  }
  if (isImage(object.contentType) && url !== null) {
    return <img src={url} alt={baseName(object.path)} className="h-full w-full rounded-t-lg object-cover" />
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-subtle">
      {isImage(object.contentType) ? <ImageIcon size={32} /> : <FileIcon size={32} />}
    </div>
  )
}
