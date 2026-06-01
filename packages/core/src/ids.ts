import { createHash, randomBytes, randomUUID } from 'node:crypto'

/** Hard-coded placeholder owner until real auth lands. */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export function newId(): string {
  return randomUUID()
}

/** A fresh agent API key. Shown to the caller once; only its hash is stored. */
export function newAgentKey(): string {
  return `wln_agt_${randomBytes(24).toString('hex')}`
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Non-secret prefix kept for display (e.g. `wln_agt_1a2b…`). */
export function keyPrefix(key: string): string {
  return key.slice(0, 12)
}

/** A short, DNS/identifier-safe database name for a provisioned project. The prefix
 * defaults to `proj`; callers can vary it so parallel test suites don't share a
 * per-project database namespace. */
export function newDatabaseName(prefix = 'proj'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}
