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

/** Human label for a scope request's target resource, given the resolved project name
 * (when the resource is a project/branch). Org-scoped agents can target any of these. */
export function resourceTargetLabel(resourceType: string, projectName: string | null): string {
  if (resourceType === 'org') {
    return 'the organization'
  }
  if (resourceType === 'branch') {
    return projectName ?? 'a branch'
  }
  return projectName ?? '—'
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

/** Compact, human duration from a number of seconds, e.g. `90` -> `90s`, `3600` -> `1h`,
 * `604800` -> `7d`. Used to render a scope request's requested time-box. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h`
  }
  return `${Math.round(seconds / 86400)}d`
}

/** Short label for when a scope lapses, e.g. `expires in 59m`, or `expired` once past.
 * Returns null for a permanent (null) expiry, so callers render nothing. */
export function expiresLabel(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null) {
    return null
  }
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) {
    return null
  }
  const remaining = Math.round((at - now) / 1000)
  return remaining <= 0 ? 'expired' : `expires in ${formatDuration(remaining)}`
}
