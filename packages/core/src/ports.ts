/**
 * Single source of truth for deriving every local port — and the connection
 * strings that embed one — from a single `PORT_PREFIX` knob.
 *
 * Convention: `PORT_PREFIX` is a two-digit string and each service's port is the
 * prefix followed by a two-digit offset (web = `00`, api = `01`, postgres = `02`,
 * minio = `03`, minio-console = `04`). We *concatenate strings* rather than do
 * arithmetic so this code and the docker-compose interpolation (`${PORT_PREFIX}02`)
 * derive byte-identical ports.
 *
 * Default prefix `30` reproduces the historical `3000 / 3001 / 3002` layout, so
 * leaving `PORT_PREFIX` unset changes nothing. Pick a different two-digit prefix
 * (e.g. `41`) to move the whole stack — docker, api, web, drizzle, tests — to
 * `4100 / 4101 / 4102`, letting two fully isolated copies run side by side.
 */

export const DEFAULT_PORT_PREFIX = '30'

/** Per-service offsets within a prefix block. */
export const PORT_OFFSETS = {
  web: '00',
  api: '01',
  postgres: '02',
  /** MinIO S3 API — the local object store backing per-branch storage. */
  minio: '03',
  /** MinIO web console (operator UI), handy for eyeballing blobs in dev. */
  minioConsole: '04',
} as const

export type PortService = keyof typeof PORT_OFFSETS

/**
 * Validate a raw prefix (typically `process.env.PORT_PREFIX`) and return it
 * normalized, falling back to {@link DEFAULT_PORT_PREFIX} when unset/empty.
 *
 * Throws on anything that wouldn't yield a usable, unprivileged four-digit port
 * so a typo fails loudly at startup instead of silently binding the wrong port.
 * Two digits keeps every derived port in `1100`–`9902`; we additionally reject
 * `< 11` because `1000`–`1002` fall in the privileged (`< 1024`) range.
 */
export function normalizePortPrefix(raw?: string): string {
  const prefix = (raw ?? '').trim() || DEFAULT_PORT_PREFIX
  if (!/^\d{2}$/.test(prefix)) {
    throw new Error(
      `PORT_PREFIX must be exactly two digits (got "${prefix}"). ` +
        'Ports derive as <prefix>00/01/02 — e.g. PORT_PREFIX=41 -> 4100/4101/4102.',
    )
  }
  if (Number(prefix) < 11) {
    throw new Error(
      `PORT_PREFIX must be >= 11 to stay out of the privileged (<1024) port range (got "${prefix}").`,
    )
  }
  return prefix
}

/** The numeric port for a service under the given prefix. */
export function portFor(service: PortService, prefix?: string): number {
  return Number(`${normalizePortPrefix(prefix)}${PORT_OFFSETS[service]}`)
}

export interface LocalDbUrlOptions {
  /** Database name (the URL path component). Required — there's no safe default. */
  database: string
  /** Port prefix; defaults to {@link DEFAULT_PORT_PREFIX}. */
  prefix?: string
  user?: string
  password?: string
  host?: string
}

/** Build a local Postgres connection string whose port derives from the prefix. */
export function localPostgresUrl(options: LocalDbUrlOptions): string {
  const { database, prefix, user = 'walnut', password = 'walnut', host = 'localhost' } = options
  return `postgres://${user}:${password}@${host}:${portFor('postgres', prefix)}/${database}`
}

/** Build a local `http://host:port` URL for a service whose port derives from the prefix. */
export function localServiceUrl(service: PortService, prefix?: string, host = 'localhost'): string {
  return `http://${host}:${portFor(service, prefix)}`
}

/** The local MinIO S3 endpoint (`http://host:<prefix>03`) the `local` blob provider targets —
 * the storage analog of {@link localPostgresUrl}. Production points at R2 via an explicit
 * endpoint instead; this keeps the single-knob promise for offline/test runs. */
export function localS3Endpoint(prefix?: string, host = 'localhost'): string {
  return localServiceUrl('minio', prefix, host)
}
