import type { PageRequest } from '../types.ts'

/**
 * Pure, engine-agnostic pagination math. Keyset cursor encoding lives in the adapter (it
 * depends on the sort-key values), but offset arithmetic and the over-fetch "has next" probe
 * are universal and live here so they can be unit-tested without a database.
 */

/** The default page size when a host doesn't specify one. */
export const DEFAULT_PAGE_SIZE = 50

/** A fresh offset page at the start of a table. */
export function firstOffsetPage(limit: number): Extract<PageRequest, { kind: 'offset' }> {
  return { kind: 'offset', limit, offset: 0, withTotal: false }
}

/** Clamp an offset to a valid range: never negative, and (when the total is known) never past
 * the last page's start. */
export function clampOffset(offset: number, limit: number, total: number | null): number {
  if (offset < 0) {
    return 0
  }
  if (total !== null && total > 0) {
    const lastPageStart = Math.floor((total - 1) / limit) * limit
    return Math.min(offset, lastPageStart)
  }
  if (total === 0) {
    return 0
  }
  return offset
}

/** The 1-based page number an offset falls on. */
export function pageNumber(offset: number, limit: number): number {
  return Math.floor(offset / limit) + 1
}

/** Total number of pages for a known row count (at least 1, even when empty). */
export function pageCount(total: number, limit: number): number {
  if (total <= 0) {
    return 1
  }
  return Math.ceil(total / limit)
}

/**
 * Apply the over-fetch probe: an adapter asks for `limit + 1` rows to learn whether another
 * page exists without a `COUNT(*)`. This trims the extra row and reports `hasNext`. `rows`
 * may exceed `limit + 1` defensively; anything beyond `limit` is dropped.
 */
export function trimProbe<T>(rows: T[], limit: number): { rows: T[]; hasNext: boolean } {
  if (rows.length > limit) {
    return { rows: rows.slice(0, limit), hasNext: true }
  }
  return { rows, hasNext: false }
}
