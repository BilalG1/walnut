import { t } from 'elysia'

/**
 * A canonical UUID path/param schema. Every resource id in the platform is a Postgres `uuid`
 * column, so a non-UUID id (e.g. `/api/projects/foo`) would otherwise reach the database and
 * fail the `uuid` cast — surfacing as an opaque 500 (and leaking the raw PG error + spamming
 * Sentry). Validating the shape here turns that into a clean 422 *before* any DB call.
 *
 * We use `pattern` (always enforced by TypeBox) rather than `format: 'uuid'` (a no-op unless the
 * format is registered) so the guard can't silently fall open. Canonical 8-4-4-4-12 hex form —
 * the shape every first-party client (dashboard + CLI) sends.
 */
export const uuid = t.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  error: 'Invalid id: expected a UUID.',
})
