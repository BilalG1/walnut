import { Check, ChevronDown, ChevronRight, Copy } from '@walnut/icons'
import { useState } from 'react'

/** curl: list objects under the (whole) branch. */
const LIST_EXAMPLE = `curl "$WALNUT_STORAGE_URL/ls" \\
  -H "Authorization: Bearer $WALNUT_STORAGE_TOKEN"`

/** curl: a download is two steps — ask for a short-lived presigned URL, then GET the bytes. */
const DOWNLOAD_EXAMPLE = `# returns { "url": "https://…", … } — GET that url for the bytes
curl "$WALNUT_STORAGE_URL/download?path=docs/readme.txt" \\
  -H "Authorization: Bearer $WALNUT_STORAGE_TOKEN"`

/** JS: an upload is a two-phase, content-addressed write (the non-obvious part). */
const UPLOAD_EXAMPLE = `const base = process.env.WALNUT_STORAGE_URL
const headers = {
  Authorization: \`Bearer \${process.env.WALNUT_STORAGE_TOKEN}\`,
  'content-type': 'application/json',
}

const bytes = await file.arrayBuffer()
const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('')

// 1. start the upload — instantly commits if these exact bytes already exist
const start = await fetch(\`\${base}/upload\`, {
  method: 'POST', headers,
  body: JSON.stringify({ path: file.name, sha256, size: bytes.byteLength }),
}).then((r) => r.json())

// 2. new bytes: PUT them to the presigned URL, then commit
if (start.status === 'upload') {
  await fetch(start.url, { method: 'PUT', body: bytes })
  await fetch(\`\${base}/commit\`, {
    method: 'POST', headers, body: JSON.stringify({ path: file.name }),
  })
}`

/** A code block with a hover/Copy affordance. The snippets reference the env vars (never the raw
 * secret), so they're copy-paste-safe whether or not a fresh token is on screen. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="group relative">
      <pre className="overflow-x-auto whitespace-pre rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-secondary">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="absolute right-1.5 top-1.5 rounded-md border border-line bg-surface p-1 text-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

/**
 * Collapsible "how to use these credentials" docs for the Connect dialog. The storage surface is
 * deliberately NOT S3-compatible, so without examples a user has env vars and no idea what to do
 * with them — this is the protocol reference, inline where the credentials are minted. Examples use
 * the env-var names from the copyable env block, so they work as-is once those are set.
 */
export function StorageUsageExamples() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-fg-secondary hover:text-fg"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        How to use these credentials
      </button>
      {open ? (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <div>
            <div className="mb-1 text-xs text-subtle">List objects</div>
            <CodeBlock code={LIST_EXAMPLE} />
          </div>
          <div>
            <div className="mb-1 text-xs text-subtle">Download a file</div>
            <CodeBlock code={DOWNLOAD_EXAMPLE} />
          </div>
          <div>
            <div className="mb-1 text-xs text-subtle">Upload a file (two-phase, content-addressed)</div>
            <CodeBlock code={UPLOAD_EXAMPLE} />
          </div>
          <p className="text-xs text-faint">
            All endpoints take <span className="font-mono">Authorization: Bearer $WALNUT_STORAGE_TOKEN</span>. Full
            set: <span className="font-mono">ls</span>, <span className="font-mono">stat</span>,{' '}
            <span className="font-mono">download</span>, <span className="font-mono">upload</span>,{' '}
            <span className="font-mono">commit</span>, <span className="font-mono">delete</span>. Uploads &
            downloads go straight to object storage via short-lived presigned URLs.
          </p>
        </div>
      ) : null}
    </div>
  )
}
