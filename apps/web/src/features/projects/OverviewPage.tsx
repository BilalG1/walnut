import { Badge, Card } from '@walnut/ui'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useBranches, useProject } from '../../data/queries.ts'

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
  const { data: branches } = useBranches(projectId)
  const current = branches?.find((b) => b.name === branch)
  if (error !== null) {
    return (
      <PageContainer>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-2 text-sm text-danger">{error.message}</p>
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <Badge tone="neutral">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {project?.name ?? '…'} · {branch}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-subtle">This branch's database, activity and health.</p>
      <div className="mt-6 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status" value={current?.status ?? project?.status ?? '…'} />
        <Stat label="Provider" value={project?.provider ?? '…'} />
        <Stat label="Region" value={current?.region ?? '—'} />
        <Stat label="Branch" value={branch} />
      </div>
    </PageContainer>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-subtle">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </Card>
  )
}
