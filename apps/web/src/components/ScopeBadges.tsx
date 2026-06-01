import { scopeDescription, scopeLabel } from '../lib/format.ts'

export function ScopeBadges({ scopes }: { scopes: readonly string[] }) {
  if (scopes.length === 0) {
    return <span className="text-xs italic text-neutral-500">no scopes</span>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((scope) => (
        <span
          key={scope}
          title={scopeDescription(scope)}
          className="inline-flex items-center rounded border border-walnut-500/30 bg-walnut-500/10 px-1.5 py-0.5 font-mono text-xs text-walnut-400"
        >
          {scopeLabel(scope)}
        </span>
      ))}
    </span>
  )
}
