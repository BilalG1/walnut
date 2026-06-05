import type { BadgeTone } from '@walnut/ui'

/** Map a project status to a badge tone. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'active':
      return 'emerald'
    case 'provisioning':
      return 'amber'
    case 'error':
      return 'red'
    default:
      return 'neutral'
  }
}

/** Map a scope to a risk-coded badge tone: db scopes by rising risk (read low → ddl/delete high);
 * non-database scopes (e.g. `branch:create`) get their own distinct tone, not on the db risk scale. */
export function scopeTone(scope: string): BadgeTone {
  switch (scope) {
    case 'db:read':
      return 'emerald'
    case 'db:write':
      return 'amber'
    case 'db:delete':
      return 'red'
    case 'db:ddl':
      return 'purple'
    case 'branch:create':
      return 'indigo'
    default:
      return 'neutral'
  }
}
