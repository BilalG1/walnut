import { File as FileIcon, ImageIcon } from '@walnut/icons'
import { Badge, Card } from '@walnut/ui'
import { DeleteButton, DownloadButton, formatBytes, isImage, type ViewContext, typeLabel } from './common.tsx'

/** Variant A — a dense, flat table of every object (S3-console style). Paths shown in full. */
export function TableView({ projectId, branch, objects, onDelete, deleting }: ViewContext) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[1fr_5rem_6rem_4.5rem] items-center gap-3 border-b border-line bg-hover/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-subtle">
        <span>Name</span>
        <span>Type</span>
        <span className="text-right">Size</span>
        <span />
      </div>
      <div className="divide-y divide-line">
        {objects.map((o) => (
          <div
            key={o.path}
            className="grid grid-cols-[1fr_5rem_6rem_4.5rem] items-center gap-3 px-4 py-2 text-sm hover:bg-hover/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              {isImage(o.contentType) ? (
                <ImageIcon size={15} className="shrink-0 text-subtle" />
              ) : (
                <FileIcon size={15} className="shrink-0 text-subtle" />
              )}
              <span className="truncate font-mono text-[13px]">{o.path}</span>
            </span>
            <span>
              <Badge tone="neutral">{typeLabel(o.contentType)}</Badge>
            </span>
            <span className="text-right tabular-nums text-muted">{formatBytes(o.size)}</span>
            <span className="flex justify-end gap-1">
              <DownloadButton projectId={projectId} branch={branch} path={o.path} />
              <DeleteButton path={o.path} onDelete={onDelete} busy={deleting === o.path} />
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
