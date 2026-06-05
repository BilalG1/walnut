import { describe, expect, test } from 'bun:test'
import { branchAncestry, newId } from '@walnut/core'
import { branches, physicalObjects, storageObjects } from '@walnut/db'
import { and, eq } from 'drizzle-orm'
import { listObjects, resolveObject } from '../src/services/storage.ts'
import { h, newProject, useHarness } from './support.ts'

useHarness()

// Model-based + differential testing for the manifest resolution queries — the correctness heart
// of storage. Instead of a handful of enumerated golden cases, we drive RANDOM branch trees and
// random write/delete/overwrite sequences, maintain a tiny reference overlay model in JS, and
// assert resolveObject + listObjects match the model (and each other) for every (branch, path).
//
// The resolution queries only consume a branch's denormalized `ancestry` array, so we build trees
// by DIRECT row insert (no per-branch DB provisioning) — fast and deterministic. Each scenario is
// rooted at a SYNTHETIC root branch (parentId null, ancestry = [self]) so scenarios in one project
// stay storage-isolated. A fixed seed per scenario makes any failure reproducible.

// ── Seeded PRNG (mulberry32) — reproducible randomness without Math.random(). ──────────────────
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const int = (r: () => number, n: number): number => Math.floor(r() * n)
function pick<T>(r: () => number, arr: readonly T[]): T {
  const v = arr[int(r, arr.length)]
  if (v === undefined) {
    throw new Error('pick from empty array')
  }
  return v
}

/** Byte (UTF-8) ordering — what Postgres `COLLATE "C"` uses. JS string `<` compares UTF-16 code
 * units, which DIVERGES from UTF-8 byte order for non-ASCII, so the model must compare bytes. */
const cCompare = (x: string, y: string): number => Buffer.compare(Buffer.from(x, 'utf8'), Buffer.from(y, 'utf8'))

// A pool with paths that are prefixes of one another and several multi-byte keys, so prefix
// bounds, byte-ordering, and the non-ASCII `starts_with` backstop all get exercised. Crucially, for
// each multibyte prefix we include a SIBLING that sorts just AFTER it in C order but is NOT
// byte-prefixed by it ('ê/w' after 'é', '😁/w' after '😀'): with no ASCII upper bound those would
// leak into a `>= prefix` scan, so they're only excluded by `starts_with` — making it load-bearing.
const PATHS = [
  'a', 'a/b', 'a/bb', 'a/b/c', 'ab', 'b', 'img/1.png', 'img/2.png', 'img/10.png', 'x', 'x/y',
  'm', 'm/n', 'é', 'é/v', 'ê/w', '😀', '😀/z', '😁/w',
] as const
const PREFIXES = ['', 'a', 'a/', 'a/b', 'img/', 'x', 'm', 'é', 'é/', '😀', '😀/', 'zzz'] as const

/** Cumulative probability thresholds for the random op kinds (the remainder is staged-overwrite
 * noise): a committed write/overwrite, a tombstone delete, then a pending-placeholder noise row. */
const OP = { write: 0.55, deleteTombstone: 0.78, pendingNoise: 0.89 } as const

interface Branch {
  id: string
  ancestry: string[]
}
/** A branch's OWNED committed view of one path: a live object or a tombstone. */
interface Owned {
  deleted: boolean
  physicalKey: string | null
  size: number
}
/** The reference model: branchId → path → owned committed view. Reads resolve nearest-ancestor-wins
 * over this, exactly like the SQL. Pending/staged rows are NOISE the model never records. */
type Model = Map<string, Map<string, Owned>>

function setModel(model: Model, branchId: string, path: string, owned: Owned): void {
  let perBranch = model.get(branchId)
  if (perBranch === undefined) {
    perBranch = new Map()
    model.set(branchId, perBranch)
  }
  perBranch.set(path, owned)
}

/** Nearest-owner-wins, then drop a tombstone winner — the model the SQL must agree with. */
function modelResolve(model: Model, ancestry: readonly string[], path: string): { physicalKey: string; size: number } | null {
  for (const id of ancestry) {
    const owned = model.get(id)?.get(path)
    if (owned !== undefined) {
      return owned.deleted || owned.physicalKey === null ? null : { physicalKey: owned.physicalKey, size: owned.size }
    }
  }
  return null
}

function modelList(model: Model, ancestry: readonly string[], prefix: string): { path: string; physicalKey: string; size: number }[] {
  const paths = new Set<string>()
  for (const id of ancestry) {
    for (const p of model.get(id)?.keys() ?? []) {
      paths.add(p)
    }
  }
  const live: { path: string; physicalKey: string; size: number }[] = []
  for (const p of paths) {
    if (!p.startsWith(prefix)) {
      continue
    }
    const r = modelResolve(model, ancestry, p)
    if (r !== null) {
      live.push({ path: p, physicalKey: r.physicalKey, size: r.size })
    }
  }
  return live.toSorted((l, r) => cCompare(l.path, r.path))
}

let keyCounter = 0
function nextKey(projectId: string): string {
  keyCounter += 1
  return `${projectId}/blobs/${keyCounter.toString(16).padStart(64, '0')}`
}

/** Upsert a branch's committed divergence row (live object or tombstone), clearing any staging —
 * mirrors the service's upsertCommitted. */
async function putCommitted(branchId: string, path: string, o: Owned): Promise<void> {
  if (o.physicalKey !== null) {
    await h.ctx.db.insert(physicalObjects).values({ physicalKey: o.physicalKey, size: o.size }).onConflictDoNothing()
  }
  const view = {
    physicalKey: o.physicalKey,
    deleted: o.deleted,
    size: o.size,
    contentType: o.deleted ? null : 'application/octet-stream',
    etag: null,
    state: 'committed' as const,
    stagedPhysicalKey: null,
    stagedSize: 0,
    stagedContentType: null,
  }
  await h.ctx.db
    .insert(storageObjects)
    .values({ ownerBranchId: branchId, path, ...view })
    .onConflictDoUpdate({ target: [storageObjects.ownerBranchId, storageObjects.path], set: view })
}

/** NOISE: a brand-new pending placeholder (state pending, no committed view). Must be invisible to
 * reads — the model never records it, so resolution must still match. Only for unowned paths.
 * Uses a distinct size (7) so a leaked noise value would be instantly recognisable in a mismatch. */
async function putPendingNoise(projectId: string, branchId: string, path: string): Promise<void> {
  const key = nextKey(projectId)
  await h.ctx.db.insert(physicalObjects).values({ physicalKey: key, size: 7 }).onConflictDoNothing()
  await h.ctx.db
    .insert(storageObjects)
    .values({ ownerBranchId: branchId, path, state: 'pending', stagedPhysicalKey: key, stagedSize: 7 })
    .onConflictDoNothing()
}

/** NOISE: stage an in-flight overwrite on a branch that already owns a live committed row (set the
 * staged_* columns only). The committed view is untouched, so resolution must be unaffected. */
async function putStagedNoise(projectId: string, branchId: string, path: string): Promise<void> {
  const key = nextKey(projectId)
  await h.ctx.db.insert(physicalObjects).values({ physicalKey: key, size: 9 }).onConflictDoNothing()
  await h.ctx.db
    .update(storageObjects)
    .set({ stagedPhysicalKey: key, stagedSize: 9 })
    .where(and(eq(storageObjects.ownerBranchId, branchId), eq(storageObjects.path, path)))
}

/** Build one random scenario (synthetic-root branch tree + random op sequence) into `model` + DB. */
async function buildScenario(projectId: string, seed: number, model: Model): Promise<Branch[]> {
  const r = makeRng(seed)
  // Synthetic root for this scenario — its own lineage, so scenarios don't see each other.
  const rootId = newId()
  await h.ctx.db.insert(branches).values({
    id: rootId,
    projectId,
    name: `s${seed}-root`,
    parentId: null,
    ancestry: branchAncestry(rootId),
  })
  const tree: Branch[] = [{ id: rootId, ancestry: [rootId] }]
  // A handful of forks, each off a random existing branch in this scenario.
  const forks = 5 + int(r, 4)
  for (let i = 0; i < forks; i++) {
    const parent = pick(r, tree)
    const id = newId()
    const ancestry = branchAncestry(id, parent.ancestry)
    // eslint-disable-next-line no-await-in-loop
    await h.ctx.db.insert(branches).values({ id, projectId, name: `s${seed}-b${i}`, parentId: parent.id, ancestry })
    tree.push({ id, ancestry })
  }
  // Random write / overwrite / delete / noise ops over the whole tree.
  const ops = 60
  for (let i = 0; i < ops; i++) {
    const br = pick(r, tree)
    const path = pick(r, PATHS)
    const owned = model.get(br.id)?.get(path)
    const roll = r()
    if (roll < OP.write) {
      const o: Owned = { deleted: false, physicalKey: nextKey(projectId), size: 1 + int(r, 5000) }
      // eslint-disable-next-line no-await-in-loop
      await putCommitted(br.id, path, o)
      setModel(model, br.id, path, o)
    } else if (roll < OP.deleteTombstone) {
      const o: Owned = { deleted: true, physicalKey: null, size: 0 }
      // eslint-disable-next-line no-await-in-loop
      await putCommitted(br.id, path, o)
      setModel(model, br.id, path, o)
    } else if (roll < OP.pendingNoise) {
      // Pending placeholder only where the branch owns no committed row yet (else it'd be staging).
      if (owned === undefined) {
        // eslint-disable-next-line no-await-in-loop
        await putPendingNoise(projectId, br.id, path)
      }
    } else if (owned !== undefined && !owned.deleted) {
      // Staged overwrite noise only on a live committed row.
      // eslint-disable-next-line no-await-in-loop
      await putStagedNoise(projectId, br.id, path)
    }
  }
  return tree
}

describe('manifest resolution — model-based (random scenarios)', () => {
  test('resolveObject + listObjects + pagination match a reference overlay model', async () => {
    const project = await newProject('prop-model')
    const model: Model = new Map()
    const pointMismatches: unknown[] = []
    const listMismatches: unknown[] = []
    const pageMismatches: unknown[] = []

    for (const seed of [1, 2, 3, 4, 5]) {
      // eslint-disable-next-line no-await-in-loop
      const tree = await buildScenario(project.id, seed, model)

      for (const br of tree) {
        // Point-get: every path resolves exactly as the model says.
        for (const path of PATHS) {
          // eslint-disable-next-line no-await-in-loop
          const got = await resolveObject(h.ctx, br.ancestry, path)
          const g = got === null ? null : { physicalKey: got.physicalKey, size: got.size }
          const want = modelResolve(model, br.ancestry, path)
          if (JSON.stringify(g) !== JSON.stringify(want)) {
            pointMismatches.push({ seed, branch: br.id, path, got: g, want })
          }
        }
        // Prefix-list: the full listing equals the model's, byte-sorted, tombstones excluded.
        for (const prefix of PREFIXES) {
          // eslint-disable-next-line no-await-in-loop
          const res = await listObjects(h.ctx, br.ancestry, prefix, { limit: 10_000 })
          const got = res.objects.map((o) => ({ path: o.path, physicalKey: o.physicalKey, size: o.size }))
          const want = modelList(model, br.ancestry, prefix)
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            listMismatches.push({ seed, branch: br.id, prefix, got, want })
          }
        }
        // Keyset pagination over the full view: small pages must reassemble the full listing with
        // no overlap or gaps (the case interleaved tombstones can break).
        // eslint-disable-next-line no-await-in-loop
        const full = (await listObjects(h.ctx, br.ancestry, '', { limit: 10_000 })).objects.map((o) => o.path)
        const paged: string[] = []
        let after: string | undefined
        for (let guard = 0; guard < 10_000; guard++) {
          // eslint-disable-next-line no-await-in-loop
          const page = await listObjects(h.ctx, br.ancestry, '', { limit: 3, after })
          paged.push(...page.objects.map((o) => o.path))
          if (page.nextCursor === null) {
            break
          }
          after = page.nextCursor
        }
        if (JSON.stringify(paged) !== JSON.stringify(full)) {
          pageMismatches.push({ seed, branch: br.id, full, paged })
        }
      }
    }

    expect(pointMismatches).toEqual([])
    expect(listMismatches).toEqual([])
    expect(pageMismatches).toEqual([])
  }, 120_000)
})

describe('manifest resolution — differential (point-get vs prefix-list)', () => {
  test('resolveObject(path) never disagrees with the same path in listObjects("")', async () => {
    // The two queries encode the same nearest-wins-drop-tombstone rule in INDEPENDENT SQL
    // formulations, so cross-checking them needs no reference model: any disagreement on any
    // (branch, path) is a bug in one of them. Deliberately kept separate from the model-based test —
    // it's a model-FREE guard, so it stays valid even if the reference model itself were wrong.
    const project = await newProject('prop-diff')
    const model: Model = new Map()
    const mismatches: unknown[] = []

    for (const seed of [11, 12, 13, 14, 15]) {
      // eslint-disable-next-line no-await-in-loop
      const tree = await buildScenario(project.id, seed, model)
      for (const br of tree) {
        // eslint-disable-next-line no-await-in-loop
        const list = await listObjects(h.ctx, br.ancestry, '', { limit: 10_000 })
        const byPath = new Map(list.objects.map((o) => [o.path, { physicalKey: o.physicalKey, size: o.size }]))
        for (const path of PATHS) {
          // eslint-disable-next-line no-await-in-loop
          const ro = await resolveObject(h.ctx, br.ancestry, path)
          const inList = byPath.get(path)
          if (ro === null && inList !== undefined) {
            mismatches.push({ kind: 'listed-but-not-resolved', seed, branch: br.id, path, inList })
          } else if (ro !== null && inList === undefined) {
            mismatches.push({ kind: 'resolved-but-not-listed', seed, branch: br.id, path, ro: { physicalKey: ro.physicalKey, size: ro.size } })
          } else if (ro !== null && inList !== undefined && (ro.physicalKey !== inList.physicalKey || ro.size !== inList.size)) {
            mismatches.push({ kind: 'fields-differ', seed, branch: br.id, path, ro: { physicalKey: ro.physicalKey, size: ro.size }, inList })
          }
        }
      }
    }

    expect(mismatches).toEqual([])
  }, 120_000)
})
