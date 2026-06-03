import { DatabaseViewer } from '@walnut/db-viewer'
import '@walnut/db-viewer/styles.css'
import { createPostgresAdapter } from '@walnut/db-viewer/postgres'
import { EmptyState, Spinner } from '@walnut/ui'
import { useMemo } from 'react'
import { api } from '../../api.ts'
import { useScope } from '../../app/useScope.ts'
import { unwrap } from '../../data/http.ts'

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

  // No page header — the viewer fills the whole area below the top bar (3.5rem tall).
  // key on projectId+branch: each branch is a different database, so remount the viewer for a
  // clean slate (table list, filter, selection) rather than swapping the adapter.
  return (
    <div className="h-[calc(100vh-3.5rem)] p-4">
      <DatabaseViewer
        key={`${projectId}:${branch}`}
        adapter={adapter}
        className="walnut-dbv h-full"
        components={{ Spinner, Empty: EmptyState }}
      />
    </div>
  )
}
