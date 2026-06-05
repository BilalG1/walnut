import { Card } from '@walnut/ui'
import { baseName, DeleteButton, DownloadButton, formatBytes, Thumb, type ViewContext, typeLabel } from './common.tsx'

/** Variant C — a media gallery: each object is a card with an image thumbnail (for images) or a
 * type icon, name, and size. Best for buckets of media/model artifacts. */
export function GalleryView({ projectId, branch, objects, onDelete, deleting }: ViewContext) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {objects.map((o) => (
        <Card key={o.path} className="group flex flex-col overflow-hidden">
          <div className="aspect-[4/3] border-b border-line bg-hover/40">
            <Thumb projectId={projectId} branch={branch} object={o} />
          </div>
          <div className="flex flex-1 flex-col gap-1 p-3">
            <span className="truncate text-[13px] font-medium" title={o.path}>
              {baseName(o.path)}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-subtle">
              {typeLabel(o.contentType)} · {formatBytes(o.size)}
            </span>
            <div className="mt-1 flex justify-end gap-1">
              <DownloadButton projectId={projectId} branch={branch} path={o.path} />
              <DeleteButton path={o.path} onDelete={onDelete} busy={deleting === o.path} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
