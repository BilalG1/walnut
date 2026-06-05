import { ChevronRight, File as FileIcon, Folder, ImageIcon } from '@walnut/icons'
import { Badge, Card } from '@walnut/ui'
import { useState } from 'react'
import { DeleteButton, DownloadButton, formatBytes, isImage, type StorageObject, type ViewContext } from './common.tsx'

/** The immediate sub-folders and files directly under `prefix`, derived from flat paths by '/' . */
function childrenOf(objects: StorageObject[], prefix: string): { folders: string[]; files: StorageObject[] } {
  const folders = new Set<string>()
  const files: StorageObject[] = []
  for (const o of objects) {
    if (!o.path.startsWith(prefix)) {
      continue
    }
    const rest = o.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      files.push(o)
    } else {
      folders.add(rest.slice(0, slash))
    }
  }
  return { folders: [...folders].toSorted(), files }
}

/** Variant B — a folder explorer: paths with '/' read as directories you drill into, with a
 * breadcrumb back up. Familiar file-manager mental model for nested keyspaces. */
export function ExplorerView({ projectId, branch, objects, onDelete, deleting }: ViewContext) {
  const [prefix, setPrefix] = useState('')
  const { folders, files } = childrenOf(objects, prefix)
  const crumbs = prefix === '' ? [] : prefix.slice(0, -1).split('/')

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-1 border-b border-line bg-hover/40 px-4 py-2 text-[13px]">
        <button type="button" className="text-accent hover:underline" onClick={() => setPrefix('')}>
          root
        </button>
        {crumbs.map((seg, i) => {
          const upto = `${crumbs.slice(0, i + 1).join('/')}/`
          return (
            <span key={upto} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-subtle" />
              <button type="button" className="text-accent hover:underline" onClick={() => setPrefix(upto)}>
                {seg}
              </button>
            </span>
          )
        })}
      </div>
      <div className="divide-y divide-line">
        {folders.length === 0 && files.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-subtle">This folder is empty.</div>
        ) : null}
        {folders.map((name) => (
          <button
            type="button"
            key={`d:${name}`}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-hover/50"
            onClick={() => setPrefix(`${prefix}${name}/`)}
          >
            <Folder size={16} className="shrink-0 text-walnut-500" />
            <span className="font-medium">{name}/</span>
          </button>
        ))}
        {files.map((o) => (
          <div key={o.path} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-hover/50">
            {isImage(o.contentType) ? (
              <ImageIcon size={16} className="shrink-0 text-subtle" />
            ) : (
              <FileIcon size={16} className="shrink-0 text-subtle" />
            )}
            <span className="min-w-0 flex-1 truncate">{o.path.slice(prefix.length)}</span>
            <Badge tone="neutral">{formatBytes(o.size)}</Badge>
            <DownloadButton projectId={projectId} branch={branch} path={o.path} />
            <DeleteButton path={o.path} onDelete={onDelete} busy={deleting === o.path} />
          </div>
        ))}
      </div>
    </Card>
  )
}
