import { Copy } from '@walnut/icons'
import { Button, Dialog, EmptyState, Spinner } from '@walnut/ui'
import { useState } from 'react'
import { useBranch } from '../../data/queries.ts'
import { maskConnectionUri } from '../../lib/format.ts'

/** The branch's owner connection string, shown in a modal off the Database page. Agents never use
 * this — they connect through their own scoped roles — so it lives one click away rather than as a
 * peer tab. */
export function ConnectionDialog({
  projectId,
  branch,
  open,
  onClose,
}: {
  projectId: string
  branch: string
  open: boolean
  onClose: () => void
}) {
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
    <Dialog open={open} onClose={onClose} title="Connection" className="max-w-lg">
      <p className="text-subtle">
        The owner connection for the <span className="font-mono">{branch}</span> branch's Postgres database.
      </p>

      <div className="mt-4">
        {isPending ? (
          <Spinner />
        ) : error !== null ? (
          <p className="text-sm text-danger">{error.message}</p>
        ) : uri === null ? (
          <EmptyState title="No connection yet" hint={`The database is ${branchData?.status ?? 'not ready'}.`} />
        ) : (
          <>
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
          </>
        )}
      </div>
    </Dialog>
  )
}
