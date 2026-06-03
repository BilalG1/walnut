import type { CellValue } from '../types.ts'

/**
 * Turn a {@link CellValue} into a plain display string. This is the single source of truth
 * for textual rendering — the default skin uses it for cell text and copy-to-clipboard, and
 * it is exhaustively unit-tested across every value kind and edge case. The renderer still
 * inspects `cell.k` directly for styling (e.g. NULL gets a faint treatment), but the *text*
 * it shows always comes from here.
 */
export function formatCell(cell: CellValue): string {
  switch (cell.k) {
    case 'null':
      return 'NULL'
    case 'text':
      return cell.v
    case 'num':
      return String(cell.v)
    case 'bigint':
      return cell.v
    case 'bool':
      return cell.v ? 'true' : 'false'
    case 'json':
      return stringifyJson(cell.v)
    case 'timestamp':
      return cell.v
    case 'date':
      return cell.v
    case 'uuid':
      return cell.v
    case 'bytea':
      return formatBytea(cell.base64, cell.bytes)
    case 'array':
      return `[${cell.v.map(formatCell).join(', ')}]`
    case 'enum':
      return cell.v
    case 'unknown':
      return cell.text
  }
}

/** True when the cell is SQL NULL — used by the renderer to style it distinctly from `''`. */
export function isNull(cell: CellValue): boolean {
  return cell.k === 'null'
}

/**
 * Compact, single-line JSON for a cell. Never throws: values that `JSON.stringify` can't
 * represent (it returns `undefined`) fall back to `String`. Database json/jsonb is always
 * representable, but the guard keeps the function total.
 */
export function stringifyJson(value: unknown): string {
  try {
    const out = JSON.stringify(value)
    if (out !== undefined) {
      return out
    }
  } catch {
    // fall through to a stringified fallback
  }
  try {
    return String(value)
  } catch {
    return '[unserializable]'
  }
}

/** A short, copy-friendly rendering of a binary value: a hex preview plus the byte count. */
export function formatBytea(base64: string, bytes: number): string {
  const hex = base64ToHex(base64, 8)
  const suffix = `(${bytes} ${bytes === 1 ? 'byte' : 'bytes'})`
  return hex === '' ? `\\x ${suffix}` : `\\x${hex}… ${suffix}`
}

/**
 * Decode the first `maxBytes` bytes of a base64 string to lowercase hex. Pure (no `atob`)
 * so it behaves identically in Bun, browsers, and tests. Returns `''` for empty input or
 * input that decodes to nothing.
 */
export function base64ToHex(base64: string, maxBytes: number): string {
  const bytes = decodeBase64(base64, maxBytes)
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {}
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    const ch = B64_ALPHABET[i]
    if (ch !== undefined) {
      table[ch] = i
    }
  }
  return table
})()

/** Decode up to `limit` bytes from a base64 string into a byte array. Ignores padding/whitespace. */
function decodeBase64(base64: string, limit: number): number[] {
  const out: number[] = []
  if (limit <= 0) {
    return out
  }
  let buffer = 0
  let bits = 0
  for (const ch of base64) {
    if (ch === '=') {
      break
    }
    const value = B64_LOOKUP[ch]
    if (value === undefined) {
      continue // skip newlines / stray whitespace
    }
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
      if (out.length >= limit) {
        break
      }
    }
  }
  return out
}

/** Byte length encoded by a base64 string, accounting for `=` padding. Used for `bytea.bytes`. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  if (clean === '') {
    return 0
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}
