import { Copy } from '@walnut/icons'
import { Button, Card, EmptyState, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import { useBranch } from '../../data/queries.ts'
import { maskConnectionUri } from '../../lib/format.ts'

export function DatabasePage() {
  const { projectId, branch } = useScope()
  if (projectId === undefined) {
    return null
  }
  return <DatabaseView projectId={projectId} branch={branch ?? 'main'} />
}

function DatabaseView({ projectId, branch }: { projectId: string; branch: string }) {
  const { data: branchData, isPending, error } = useBranch(projectId, branch)
  const [copied, setCopied] = useState(false)
  const uri = branchData?.connectionUri ?? null

  function copy() {
    if (uri === null) {
      return
    }
    void navigator.clipboard.writeText(uri)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">Connection</h1>
      <p className="mt-1 text-sm text-subtle">
        The owner connection for the <span className="font-mono">{branch}</span> branch's Postgres database.
      </p>

      <div className="mt-6">
        {isPending ? (
          <Spinner />
        ) : error !== null ? (
          <p className="text-sm text-danger">{error.message}</p>
        ) : uri === null ? (
          <EmptyState title="No connection yet" hint={`The database is ${branchData?.status ?? 'not ready'}.`} />
        ) : (
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-subtle">Connection string</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs text-fg-secondary">
                {maskConnectionUri(uri)}
              </code>
              <Button variant="ghost" onClick={copy}>
                <Copy size={15} />
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-faint">
              The password is hidden here; Copy puts the full URI on your clipboard. Agents never use this — they
              connect through their own scoped roles.
            </p>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
