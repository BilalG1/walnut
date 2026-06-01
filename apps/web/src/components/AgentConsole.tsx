import { useState } from 'react'
import { api } from '../api.ts'
import { type ApiErrorBody, readErrorBody } from '../lib/errors.ts'
import { scopeLabel } from '../lib/format.ts'
import { Button } from './ui.tsx'

type QueryData = NonNullable<Awaited<ReturnType<typeof api.agent.v1.query.post>>['data']>

interface Props {
  apiKey: string | undefined
  onScopeRequested: () => void
}

function renderCell(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

export function AgentConsole({ apiKey, onScopeRequested }: Props) {
  const [sql, setSql] = useState('select 1 as hello;')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<QueryData | null>(null)
  const [errorBody, setErrorBody] = useState<ApiErrorBody | null>(null)
  const [requested, setRequested] = useState<string[] | null>(null)

  if (apiKey === undefined) {
    return (
      <p className="text-xs text-neutral-500">
        This agent&apos;s API key isn&apos;t stored in this browser, so the console can&apos;t act as it. Create a
        new agent to try live queries.
      </p>
    )
  }

  const headers = { authorization: `Bearer ${apiKey}` }

  async function run(): Promise<void> {
    setRunning(true)
    setRequested(null)
    const res = await api.agent.v1.query.post({ sql }, { headers })
    if (res.data === null) {
      setResult(null)
      setErrorBody(readErrorBody(res.error?.value))
    } else {
      setResult(res.data)
      setErrorBody(null)
    }
    setRunning(false)
  }

  async function requestScopes(scopes: string[]): Promise<void> {
    const res = await api.agent.v1['scope-requests'].post(
      { scopes, reason: `Requested from console to run: ${sql.slice(0, 80)}` },
      { headers },
    )
    if (res.data !== null) {
      setRequested(scopes)
      onScopeRequested()
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={sql}
        spellCheck={false}
        onChange={(e) => setSql(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 outline-none focus:border-walnut-500"
      />
      <div className="flex items-center gap-2">
        <Button onClick={() => void run()} disabled={running || sql.trim().length === 0}>
          {running ? 'Running…' : 'Run as agent'}
        </Button>
        <span className="text-xs text-neutral-500">Runs through scope enforcement using this agent&apos;s key.</span>
      </div>

      {errorBody !== null && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs font-medium text-red-300">{errorBody.message}</p>
          {errorBody.missingScopes !== undefined && errorBody.missingScopes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-400">Request scope:</span>
              <Button variant="ghost" onClick={() => void requestScopes(errorBody.missingScopes ?? [])}>
                Request {errorBody.missingScopes.map(scopeLabel).join(' + ')}
              </Button>
            </div>
          )}
        </div>
      )}

      {requested !== null && (
        <p className="text-xs text-emerald-400">
          Requested {requested.map(scopeLabel).join(' + ')} — approve it in the Notifications tab, then re-run.
        </p>
      )}

      {result !== null && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
          <p className="mb-2 text-xs text-neutral-500">
            {result.command ?? 'OK'} · {result.rowCount} row(s)
          </p>
          {result.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-neutral-500">
                    {Object.keys(result.rows[0] ?? {}).map((col) => (
                      <th key={col} className="border-b border-neutral-800 px-2 py-1 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono text-neutral-200">
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((value, j) => (
                        <td key={j} className="border-b border-neutral-900 px-2 py-1">
                          {renderCell(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
