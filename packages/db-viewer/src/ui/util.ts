/** Compact human count for row estimates: 1234 → "1,234", 2_500_000 → "2.5M". Non-finite or
 * negative inputs (e.g. an "unknown" estimate) render as empty; fractionals are rounded. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return ''
  }
  const r = Math.round(n)
  // The `>= 999_500` band catches values that would round up across the million boundary (e.g.
  // 999_999 → "1M", not the nonsensical "1000K").
  if (r >= 999_500) {
    return `${trimZero(r / 1_000_000)}M`
  }
  if (r >= 10_000) {
    return `${trimZero(r / 1_000)}K`
  }
  return r.toLocaleString('en-US')
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
