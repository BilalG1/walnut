import { Copy } from '@walnut/icons'
import { Button } from '@walnut/ui'
import { useState } from 'react'

/** One-time API-key display: the key in an amber "copy it now" box with a Copy button. Shared by
 * the create-agent dialog and the agent detail page's rotate-key dialog, so the "shown once"
 * affordance stays identical wherever a fresh key is minted (the plaintext is never persisted). */
export function ApiKeyReveal({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/5 px-3 py-2 font-mono text-xs text-amber-700 dark:text-amber-200">
        {apiKey}
      </code>
      <Button variant="ghost" onClick={copy}>
        <Copy size={15} />
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}
