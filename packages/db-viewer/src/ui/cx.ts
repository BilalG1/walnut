/** Minimal class-name joiner. The package owns this rather than importing `@walnut/ui`'s `cn`,
 * so the viewer stays decoupled from the host's component library. Concatenates truthy strings,
 * with a component's own classes first and any `classNames` override last. Note: attribute order
 * doesn't decide the winner — for an override to take effect the host's rule must win on CSS
 * specificity or stylesheet order (Tailwind utilities and a later import both do). */
export type ClassInput = string | false | null | undefined

export function cx(...inputs: ClassInput[]): string {
  return inputs.filter((x): x is string => typeof x === 'string' && x !== '').join(' ')
}
