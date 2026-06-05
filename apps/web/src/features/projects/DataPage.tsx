import { DatabaseViewer } from '@walnut/db-viewer'
import '@walnut/db-viewer/styles.css'
import { createPostgresAdapter } from '@walnut/db-viewer/postgres'
import { Database, GitBranch, KeyRound } from '@walnut/icons'
import { Badge, Button, EmptyState, Spinner } from '@walnut/ui'
import { useMemo, useState } from 'react'
import { api } from '../../api.ts'
import { useScope } from '../../app/useScope.ts'
import { unwrap } from '../../data/http.ts'
import { ConnectionDialog } from './ConnectionDialog.tsx'

/** Dashboard data browser. The viewer is a self-contained `@walnut/db-viewer` whose Postgres
 * adapter posts every (parameterized) statement to the project's read-only `/sql` route — so
 * the grid stays decoupled from this app, and the database engine + SQL classifier do the
 * enforcing. We only theme it (mapping `--wdv-*` to the dashboard tokens, see index.css) and
 * lend it the dashboard's spinner/empty so it blends in. */
export function DataPage() {
  const { projectId, branch } = useScope()
  if (projectId === undefined) {
    return null
  }
  return <DataView projectId={projectId} branch={branch ?? 'main'} />
}

function DataView({ projectId, branch }: { projectId: string; branch: string }) {
  const [showConnection, setShowConnection] = useState(false)
  const adapter = useMemo(
    () =>
      createPostgresAdapter({
        run: async (sql, params, opts) => {
          // The adapter only ever emits scalars and arrays (for `= ANY`); the route's schema is
          // typed that way, so narrow the adapter's looser `unknown[]` to match.
          const scalars = params as (string | number | boolean | null | unknown[])[]
          const result = await unwrap(
            api.api
              .projects({ id: projectId })
              .branches({ branch })
              .sql.post({ sql, params: scalars }, { fetch: { signal: opts?.signal } }),
          )
          return { rows: result.rows, fields: result.fields, truncated: result.truncated }
        },
      }),
    [projectId, branch],
  )

  // A slim header carries the branch badge and the Connection action (the former subtab, now a
  // dialog); the viewer fills the rest of the area below the top bar (3.5rem tall).
  // key on projectId+branch: each branch is a different database, so remount the viewer for a
  // clean slate (table list, filter, selection) rather than swapping the adapter.
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Database size={22} className="text-walnut-500" /> Database
          <Badge tone="neutral">
            <GitBranch size={12} />
            {branch}
          </Badge>
        </h1>
        <Button variant="ghost" onClick={() => setShowConnection(true)}>
          <KeyRound size={15} />
          Connection
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <DatabaseViewer
          key={`${projectId}:${branch}`}
          adapter={adapter}
          className="walnut-dbv h-full"
          components={{ Spinner, Empty: EmptyState }}
        />
      </div>
      <ConnectionDialog
        projectId={projectId}
        branch={branch}
        open={showConnection}
        onClose={() => setShowConnection(false)}
      />
    </div>
  )
}
