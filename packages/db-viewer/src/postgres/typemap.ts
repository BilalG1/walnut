import { base64ByteLength } from '../core/format.ts'
import type { CellValue, ColumnKind, ColumnMeta } from '../types.ts'

/**
 * Map a Postgres type — as reported by `information_schema.columns` (`data_type` +
 * `udt_name`) — to the coarse {@link ColumnKind} the renderer and SQL builder switch on.
 * Many concrete types collapse to one kind; anything unrecognized becomes `unknown` and is
 * transported as its `::text` rendering (never silently dropped).
 */
export function kindFromUdt(dataType: string, udtName: string): ColumnKind {
  if (dataType === 'ARRAY') {
    return 'array'
  }
  switch (udtName) {
    case 'int2':
    case 'int4':
    case 'float4':
    case 'float8':
    case 'oid':
      return 'number'
    case 'int8':
    case 'numeric':
      // int8/numeric can exceed JS safe-integer range — kept as strings, never numbers.
      return 'bigint'
    case 'bool':
      return 'bool'
    case 'uuid':
      return 'uuid'
    case 'json':
    case 'jsonb':
      return 'json'
    case 'bytea':
      return 'bytea'
    case 'timestamp':
    case 'timestamptz':
      return 'timestamp'
    case 'date':
      return 'date'
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'char':
    case 'name':
    case 'citext':
      return 'text'
    default:
      // USER-DEFINED is almost always an enum in practice; composites/domains are rare and
      // fall through to `unknown` via their data_type.
      return dataType === 'USER-DEFINED' ? 'enum' : 'unknown'
  }
}

/** Whether a column carries time-zone information (drives the `tz` flag on timestamp cells). */
export function isTimestamptz(udtName: string): boolean {
  return udtName === 'timestamptz'
}

/**
 * Normalize one raw value (as returned by the injected `run`, after the SQL builder has cast
 * the ambiguous kinds — bigint/timestamp/date/bytea/unknown — to text) into a lossless
 * {@link CellValue}. Robust to driver variance: json may arrive parsed or as a string, bools
 * as `true` or `'t'`.
 */
export function toCellValue(col: ColumnMeta, raw: unknown): CellValue {
  if (raw === null || raw === undefined) {
    return { k: 'null' }
  }
  switch (col.kind) {
    case 'text':
      return { k: 'text', v: String(raw) }
    case 'uuid':
      return { k: 'uuid', v: String(raw) }
    case 'enum':
      return { k: 'enum', v: String(raw) }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      return { k: 'num', v: n }
    }
    case 'bigint':
      return { k: 'bigint', v: String(raw) }
    case 'bool':
      return { k: 'bool', v: raw === true || raw === 't' || raw === 'true' || raw === 1 }
    case 'json':
      return { k: 'json', v: parseJsonish(raw) }
    case 'timestamp':
      return { k: 'timestamp', v: String(raw), tz: isTimestamptz(col.udtName) }
    case 'date':
      return { k: 'date', v: String(raw) }
    case 'bytea': {
      const base64 = String(raw)
      return { k: 'bytea', base64, bytes: base64ByteLength(base64) }
    }
    case 'array':
      return toArrayCell(raw)
    case 'unknown':
      return { k: 'unknown', text: String(raw) }
  }
}

/** Base64-encode a byte array, chunked so large buffers don't overflow the argument list.
 * Works in Bun and browsers (both provide `btoa`). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Parse a json value that may already be parsed (object) or still a string. */
function parseJsonish(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Wrap a JS array (as a driver returns array columns) into an array CellValue. */
function toArrayCell(raw: unknown): CellValue {
  if (!Array.isArray(raw)) {
    // A driver that returns the Postgres array literal as a string — show it verbatim.
    return { k: 'unknown', text: String(raw) }
  }
  return { k: 'array', v: raw.map(inferCellValue) }
}

/**
 * Best-effort typing of a value from its JS runtime type alone — no column metadata. Used for
 * array elements and the raw-SQL escape hatch, where introspected types aren't available.
 */
export function inferCellValue(el: unknown): CellValue {
  if (el === null || el === undefined) {
    return { k: 'null' }
  }
  // A driver may hand back native Date / binary objects — e.g. array elements (which the SQL
  // builder doesn't cast) or the raw-SQL escape hatch. Map them to their lossless kinds rather
  // than letting them fall into the `object → json` bucket (which renders a Date as a shifted
  // ISO string and a Buffer as `{"type":"Buffer",…}`).
  if (el instanceof Date) {
    return { k: 'timestamp', v: el.toISOString(), tz: true }
  }
  if (el instanceof Uint8Array) {
    const base64 = bytesToBase64(el)
    return { k: 'bytea', base64, bytes: el.length }
  }
  switch (typeof el) {
    case 'number':
      return { k: 'num', v: el }
    case 'boolean':
      return { k: 'bool', v: el }
    case 'bigint':
      return { k: 'bigint', v: el.toString() }
    case 'string':
      return { k: 'text', v: el }
    case 'object':
      return { k: 'json', v: el }
    default:
      return { k: 'unknown', text: String(el) }
  }
}
