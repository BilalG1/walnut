import { Badge, Card } from '@walnut/ui'
import { useScope } from '../../app/useScope.ts'
import { useProject } from '../../data/queries.ts'

/** Project/branch home. Minimal for now — activity + richer stats land in a later pass. */
export function OverviewPage() {
  const { projectId, branch } = useScope()
  if (projectId === undefined) {
    return null
  }
  return <OverviewView projectId={projectId} branch={branch ?? 'main'} />
}

function OverviewView({ projectId, branch }: { projectId: string; branch: string }) {
  const { data: project, error } = useProject(projectId)
  if (error !== null) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-2 text-sm text-red-400">{error.message}</p>
      </div>
    )
  }
  return (
    <div className="p-8">
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <Badge tone="neutral">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {project?.name ?? '…'} · {branch}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-neutral-500">This branch's database, activity and health.</p>
      <div className="mt-6 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status" value={project?.status ?? '…'} />
        <Stat label="Provider" value={project?.provider ?? '…'} />
        <Stat label="Region" value={project?.region ?? '—'} />
        <Stat label="Branch" value={branch} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </Card>
  )
}
