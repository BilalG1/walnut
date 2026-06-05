/**
 * Branch ancestry — the denormalized, nearest-first chain (`{self, parent, …, root}`) the
 * storage manifest resolves reads over. It's a *rebuilt cache* of the authoritative `parentId`
 * chain, never hand-edited: branch creation prepends the new id to its parent's ancestry (O(1),
 * the instant-branch guarantee — no manifest rows are touched), and any reparent recomputes it
 * in one transaction. Kept pure so the invariant is unit-testable in isolation.
 */

/**
 * The ancestry array for a branch with id `selfId` forked from a parent whose ancestry is
 * `parentAncestry` (nearest-first, or `[]` for a root branch). Result is `[selfId,
 * ...parentAncestry]`. Throws if `selfId` already appears in the parent chain — that would be a
 * cycle, and the ancestry array must never point a branch at itself transitively.
 */
export function branchAncestry(selfId: string, parentAncestry: readonly string[] = []): string[] {
  if (parentAncestry.includes(selfId)) {
    throw new Error(`Branch ${selfId} already appears in its parent's ancestry — would form a cycle.`)
  }
  return [selfId, ...parentAncestry]
}
