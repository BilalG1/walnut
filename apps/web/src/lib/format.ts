import { SCOPE_DESCRIPTIONS, isAgentScope } from '@walnut/core/scopes'

const SCOPE_LABELS: Record<string, string> = {
  'db:read': 'Read',
  'db:write': 'Write',
  'db:delete': 'Delete',
  'db:ddl': 'Schema',
}

/** Short, human label for a scope chip (e.g. `db:read` -> `Read`). */
export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope
}

export function scopeDescription(scope: string): string {
  return isAgentScope(scope) ? SCOPE_DESCRIPTIONS[scope] : scope
}

/** Hide the password in a postgres connection string for on-screen display.
 * The full URI is still copied verbatim; this is display-only. */
export function maskConnectionUri(uri: string): string {
  return uri.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1••••••@')
}

/** Compact relative time, e.g. `5m ago`. `now` is injectable for testing. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ''
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
