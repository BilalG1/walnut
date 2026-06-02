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

/** Map a db scope to a risk-coded badge tone (read low → ddl/delete high). */
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
    default:
      return 'neutral'
  }
}
