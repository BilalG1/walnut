export type ClassValue =
  | string
  | number
  | bigint
  | null
  | boolean
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>

/**
 * Tiny clsx-style class-name combiner. We own this rather than depending on
 * clsx/tailwind-merge. Note: it concatenates only — it does NOT de-dupe conflicting
 * Tailwind utilities, so place a component's `className` override last (we do).
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  for (const input of inputs) {
    if (input === null || input === undefined || input === false || input === true || input === '') {
      continue
    }
    if (typeof input === 'string' || typeof input === 'number' || typeof input === 'bigint') {
      out.push(String(input))
    } else if (Array.isArray(input)) {
      const inner = cn(...input)
      if (inner !== '') {
        out.push(inner)
      }
    } else {
      for (const [key, value] of Object.entries(input)) {
        if (value === true) {
          out.push(key)
        }
      }
    }
  }
  return out.join(' ')
}
