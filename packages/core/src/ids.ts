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

/** A fresh organization-invite token. Like an agent key, it's shown once (in the invite
 * link) and only its hash is stored, so a link can never be re-derived after creation. */
export function newInviteToken(): string {
  return `wln_inv_${randomBytes(24).toString('hex')}`
}

/** A fresh branch storage token — the owner-level bearer credential a user plugs into their own
 * app to reach a branch's object storage over `/storage/v1` (the "Connect" feature). Like an agent
 * key it's shown once and only its hash is stored, so it can never be re-derived after creation. */
export function newStorageToken(): string {
  return `wln_st_${randomBytes(24).toString('hex')}`
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * RFC 4122 name-based UUIDv5 (SHA-1) — a stable, deterministic uuid for a `(namespace,
 * name)` pair. The same inputs always yield the same uuid, so it's how we derive a fixed
 * platform user id from a stable string (e.g. a local-auth email). `namespace` must be a
 * canonical uuid string.
 */
export function uuidv5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const digest = createHash('sha1').update(nsBytes).update(name).digest()
  const bytes = Array.from(digest.subarray(0, 16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50 // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // RFC 4122 variant
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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
