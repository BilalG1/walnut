import { Copy, KeyRound, Trash } from '@walnut/icons'
import { Button, Dialog, EmptyState, Input, Spinner } from '@walnut/ui'
import { useState, type FormEvent } from 'react'
import { API_URL } from '../../../api.ts'
import { useCreateStorageToken, useRevokeStorageToken, useStorageTokens } from '../../../data/queries.ts'
import { timeAgo } from '../../../lib/format.ts'
import { StorageUsageExamples } from './StorageUsageExamples.tsx'

/** The base URL of the owner-facing storage REST API a user plugs into their own app. Derived from
 * the dashboard's configured API origin — the single place the frontend knows the API lives. */
const storageBaseUrl = `${API_URL}/storage/v1`

/** Render the `.env`-style block a user copies into their application for the freshly minted token. */
function envBlock(token: string): string {
  return `WALNUT_STORAGE_URL=${storageBaseUrl}\nWALNUT_STORAGE_TOKEN=${token}`
}

/** One-time reveal of a freshly minted token as a copyable env block. Amber "copy it now" styling,
 * matching {@link ApiKeyReveal}; the secret is never shown again (only its hash is stored). */
function TokenReveal({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(envBlock(token))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
      <p className="text-sm text-fg-secondary">
        Copy these now — the token won&apos;t be shown again. Set them in your application&apos;s environment and
        use any HTTP client against the Walnut storage API.
      </p>
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/5 p-3">
        <pre className="overflow-x-auto whitespace-pre font-mono text-xs text-amber-700 dark:text-amber-200">
          {envBlock(token)}
        </pre>
      </div>
      <StorageUsageExamples />
      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={copy}>
          <Copy size={15} />
          {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}

/**
 * The Storage tab's "Connect" dialog. Mints and manages owner-level storage tokens — the storage
 * analog of the Database tab's connection string. A token grants an external app full
 * read/write/delete on this one branch's storage over the Walnut storage REST API.
 *
 * Deliberately honest: this is NOT an S3-compatible endpoint (that's the planned S3 gateway). For
 * now it's Walnut's own REST API — point an HTTP client (or the `walnut` CLI) at it.
 */
export function StorageConnectDialog({
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
  const { data: tokens, isPending, error } = useStorageTokens(projectId, branch, { enabled: open })
  const create = useCreateStorageToken(projectId, branch)
  const revoke = useRevokeStorageToken(projectId, branch)
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  function close() {
    setLabel('')
    setSecret(null)
    create.reset()
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = label.trim()
    if (trimmed === '' || create.isPending) {
      return
    }
    create.mutate(trimmed, {
      onSuccess: (token) => {
        setLabel('')
        setSecret(token.token)
      },
    })
  }

  function onRevoke(tokenId: string) {
    setRevoking(tokenId)
    revoke.mutate(tokenId, { onSettled: () => setRevoking(null) })
  }

  return (
    <Dialog open={open} onClose={close} title="Connect to storage" className="max-w-lg">
      {secret !== null ? (
        <TokenReveal token={secret} onDone={() => setSecret(null)} />
      ) : (
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-subtle">
            Create a token to reach the <span className="font-mono">{branch}</span> branch&apos;s storage from your
            own application. Each token has full read/write/delete on this branch.{' '}
            <span className="text-faint">
              This is the Walnut storage REST API, not an S3 endpoint — use any HTTP client (see the examples
              below).
            </span>
          </p>

          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="token-label" className="mb-1 block text-xs text-subtle">
                New token
              </label>
              <Input
                id="token-label"
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
                placeholder="e.g. prod app"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={create.isPending || label.trim() === ''}>
              <KeyRound size={15} />
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
          {create.error !== null ? <p className="text-xs text-danger">{create.error.message}</p> : null}

          <div>
            {isPending ? (
              <Spinner />
            ) : error !== null ? (
              <p className="text-sm text-danger">{error.message}</p>
            ) : tokens === undefined || tokens.length === 0 ? (
              <EmptyState title="No tokens yet" hint="Create one above to connect your application." />
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {tokens.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-fg">{t.label}</div>
                      <div className="text-xs text-faint">
                        <span className="font-mono">{t.keyPrefix}…</span> · created {timeAgo(t.createdAt)} ·{' '}
                        {t.lastUsedAt === null ? 'never used' : `used ${timeAgo(t.lastUsedAt)}`}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => onRevoke(t.id)}
                      disabled={revoking === t.id}
                      title="Revoke this token"
                    >
                      {revoking === t.id ? <Spinner /> : <Trash size={15} />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <StorageUsageExamples />
        </div>
      )}
    </Dialog>
  )
}
