import { beforeEach, describe, expect, test } from 'bun:test'
import { branches, physicalObjects, storageObjects } from '@walnut/db'
import { eq } from 'drizzle-orm'
import { listObjects, resolveObject } from '../src/services/storage.ts'
import { h, newProject, useHarness } from './support.ts'

useHarness()

/** A distinct 64-hex "sha256" per integer, so each test blob gets its own physical key. */
function hash(n: number): string {
  return n.toString(16).padStart(64, '0')
}

/** Create a branch via the API and return its id + ancestry (read straight from the manifest). */
async function makeBranch(projectId: string, name: string, from?: string): Promise<{ id: string; ancestry: string[] }> {
  const res = await h.api.api.projects({ id: projectId }).branches.post(from === undefined ? { name } : { name, from })
  const id = res.data?.id
  if (id === undefined) {
    throw new Error(`branch create failed: ${JSON.stringify(res.error?.value)}`)
  }
  const [row] = await h.ctx.db.select().from(branches).where(eq(branches.id, id))
  return { id, ancestry: row?.ancestry ?? [] }
}

async function defaultBranch(projectId: string): Promise<{ id: string; ancestry: string[] }> {
  const rows = await h.ctx.db.select().from(branches).where(eq(branches.projectId, projectId))
  const main = rows.find((b) => b.isDefault)
  return { id: main?.id ?? '', ancestry: main?.ancestry ?? [] }
}

/** Write a committed divergence row owned by `branchId`, creating its physical object first. */
async function writeObject(
  projectId: string,
  branchId: string,
  path: string,
  n: number,
  opts: { size?: number; contentType?: string } = {},
): Promise<string> {
  const physicalKey = `${projectId}/blobs/${hash(n)}`
  const size = opts.size ?? 100 + n
  await h.ctx.db.insert(physicalObjects).values({ physicalKey, size }).onConflictDoNothing()
  await h.ctx.db.insert(storageObjects).values({
    ownerBranchId: branchId,
    path,
    physicalKey,
    deleted: false,
    size,
    contentType: opts.contentType ?? 'application/octet-stream',
    state: 'committed',
  })
  return physicalKey
}

/** Write a tombstone (delete marker) row owned by `branchId`. */
async function tombstone(branchId: string, path: string): Promise<void> {
  await h.ctx.db.insert(storageObjects).values({ ownerBranchId: branchId, path, deleted: true, state: 'committed' })
}

describe('manifest resolution — point-get', () => {
  let projectId: string
  beforeEach(async () => {
    projectId = (await newProject('manifest')).id
  })

  // THE golden test: root writes a file, a child tombstones it, a grandchild rewrites it — all
  // three branch views must be correct. This is the case the tombstone-after-winner rule exists for.
  test('root write → child tombstone → grandchild rewrite: all three views correct', async () => {
    const main = await defaultBranch(projectId)
    const child = await makeBranch(projectId, 'child', 'main')
    const grandchild = await makeBranch(projectId, 'grandchild', 'child')

    const rootKey = await writeObject(projectId, main.id, 'a.txt', 1, { size: 10 })
    await tombstone(child.id, 'a.txt')
    const gcKey = await writeObject(projectId, grandchild.id, 'a.txt', 2, { size: 20 })

    // Root still sees its own file.
    const onMain = await resolveObject(h.ctx, main.ancestry, 'a.txt')
    expect(onMain?.physicalKey).toBe(rootKey)
    expect(onMain?.size).toBe(10)

    // Child's tombstone shadows the root file — it's gone, NOT resurrected from the ancestor.
    expect(await resolveObject(h.ctx, child.ancestry, 'a.txt')).toBeNull()

    // Grandchild's rewrite shadows both the tombstone and the root file.
    const onGc = await resolveObject(h.ctx, grandchild.ancestry, 'a.txt')
    expect(onGc?.physicalKey).toBe(gcKey)
    expect(onGc?.size).toBe(20)
  }, 30_000)

  test('a file written on root is inherited by descendants that never touched it', async () => {
    const main = await defaultBranch(projectId)
    const child = await makeBranch(projectId, 'c', 'main')
    const grandchild = await makeBranch(projectId, 'gc', 'c')
    const key = await writeObject(projectId, main.id, 'inherited.bin', 7)

    expect((await resolveObject(h.ctx, main.ancestry, 'inherited.bin'))?.physicalKey).toBe(key)
    expect((await resolveObject(h.ctx, child.ancestry, 'inherited.bin'))?.physicalKey).toBe(key)
    expect((await resolveObject(h.ctx, grandchild.ancestry, 'inherited.bin'))?.physicalKey).toBe(key)
  }, 30_000)

  test('a nearer overwrite wins over a farther ancestor', async () => {
    const main = await defaultBranch(projectId)
    const child = await makeBranch(projectId, 'c2', 'main')
    await writeObject(projectId, main.id, 'x', 1, { size: 1 })
    const childKey = await writeObject(projectId, child.id, 'x', 2, { size: 2 })
    expect((await resolveObject(h.ctx, child.ancestry, 'x'))?.physicalKey).toBe(childKey)
    expect((await resolveObject(h.ctx, child.ancestry, 'x'))?.size).toBe(2)
  }, 30_000)

  test('an absent path resolves to null', async () => {
    const main = await defaultBranch(projectId)
    expect(await resolveObject(h.ctx, main.ancestry, 'nope')).toBeNull()
  })

  test('a pending (in-flight) upload is invisible to reads until committed', async () => {
    const main = await defaultBranch(projectId)
    const physicalKey = `${projectId}/blobs/${hash(99)}`
    await h.ctx.db.insert(physicalObjects).values({ physicalKey, size: 5 }).onConflictDoNothing()
    await h.ctx.db
      .insert(storageObjects)
      .values({ ownerBranchId: main.id, path: 'p', physicalKey, size: 5, state: 'pending' })
    expect(await resolveObject(h.ctx, main.ancestry, 'p')).toBeNull()
    // Committing it makes it visible.
    await h.ctx.db
      .update(storageObjects)
      .set({ state: 'committed' })
      .where(eq(storageObjects.ownerBranchId, main.id))
    expect((await resolveObject(h.ctx, main.ancestry, 'p'))?.physicalKey).toBe(physicalKey)
  }, 20_000)
})

describe('manifest resolution — prefix-list', () => {
  let projectId: string
  beforeEach(async () => {
    projectId = (await newProject('manifest-list')).id
  })

  test('lists the effective view under a prefix: nearest-owner wins, tombstones excluded, sorted', async () => {
    const main = await defaultBranch(projectId)
    const child = await makeBranch(projectId, 'feat', 'main')
    // Root has three files under img/ plus one outside the prefix.
    await writeObject(projectId, main.id, 'img/a.png', 1)
    await writeObject(projectId, main.id, 'img/b.png', 2)
    await writeObject(projectId, main.id, 'img/c.png', 3)
    await writeObject(projectId, main.id, 'other.txt', 4)
    // Child overwrites b, deletes c, adds d.
    const childB = await writeObject(projectId, child.id, 'img/b.png', 5)
    await tombstone(child.id, 'img/c.png')
    const childD = await writeObject(projectId, child.id, 'img/d.png', 6)

    const onChild = await listObjects(h.ctx, child.ancestry, 'img/', { limit: 100 })
    expect(onChild.objects.map((o) => o.path)).toEqual(['img/a.png', 'img/b.png', 'img/d.png'])
    // b resolves to the child's overwrite; d is the child's own; c (tombstoned) is gone.
    const byPath = new Map(onChild.objects.map((o) => [o.path, o.physicalKey]))
    expect(byPath.get('img/b.png')).toBe(childB)
    expect(byPath.get('img/d.png')).toBe(childD)
    expect(onChild.nextCursor).toBeNull()

    // The root view is unaffected: original a/b/c, no d.
    const onMain = await listObjects(h.ctx, main.ancestry, 'img/', { limit: 100 })
    expect(onMain.objects.map((o) => o.path)).toEqual(['img/a.png', 'img/b.png', 'img/c.png'])
  }, 30_000)

  test('an empty prefix lists everything, byte-sorted', async () => {
    const main = await defaultBranch(projectId)
    await writeObject(projectId, main.id, 'zebra', 1)
    await writeObject(projectId, main.id, 'Apple', 2) // uppercase sorts before lowercase in C collation
    await writeObject(projectId, main.id, 'apple', 3)
    const res = await listObjects(h.ctx, main.ancestry, '', { limit: 100 })
    expect(res.objects.map((o) => o.path)).toEqual(['Apple', 'apple', 'zebra'])
  }, 20_000)

  test('keyset pagination walks all pages without overlap or gaps', async () => {
    const main = await defaultBranch(projectId)
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await writeObject(projectId, main.id, `f/${i}`, i + 1)
    }
    const seen: string[] = []
    let after: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      // eslint-disable-next-line no-await-in-loop
      const page = await listObjects(h.ctx, main.ancestry, 'f/', { limit: 2, after })
      seen.push(...page.objects.map((o) => o.path))
      if (page.nextCursor === null) {
        break
      }
      after = page.nextCursor
    }
    expect(seen).toEqual(['f/0', 'f/1', 'f/2', 'f/3', 'f/4'])
  }, 30_000)

  test('a prefix that matches nothing returns an empty page', async () => {
    const main = await defaultBranch(projectId)
    await writeObject(projectId, main.id, 'docs/readme', 1)
    const res = await listObjects(h.ctx, main.ancestry, 'images/', { limit: 100 })
    expect(res.objects).toEqual([])
    expect(res.nextCursor).toBeNull()
  })

  // The list-path analogue of the golden point-get test: a nearer tombstone must shadow a farther
  // live ancestor in a LISTING too (the winner-then-drop rule, across three levels).
  test('a tombstone winner shadows a live farther ancestor in a listing', async () => {
    const main = await defaultBranch(projectId)
    const mid = await makeBranch(projectId, 'mid', 'main')
    const leaf = await makeBranch(projectId, 'leaf', 'mid')
    await writeObject(projectId, main.id, 'dir/keep', 1)
    await writeObject(projectId, main.id, 'dir/gone', 2)
    await tombstone(mid.id, 'dir/gone') // nearer tombstone than the live root copy
    const res = await listObjects(h.ctx, leaf.ancestry, 'dir/', { limit: 100 })
    expect(res.objects.map((o) => o.path)).toEqual(['dir/keep'])
  }, 30_000)

  test('pagination skips no live row when tombstones are interleaved', async () => {
    const main = await defaultBranch(projectId)
    const child = await makeBranch(projectId, 'tomb', 'main')
    // Live a,c,e on root; b,d tombstoned by the child — interleaved in sort order.
    for (const [i, name] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await writeObject(projectId, main.id, `k/${name}`, i + 1)
    }
    await tombstone(child.id, 'k/b')
    await tombstone(child.id, 'k/d')
    const seen: string[] = []
    let after: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      // eslint-disable-next-line no-await-in-loop
      const page = await listObjects(h.ctx, child.ancestry, 'k/', { limit: 2, after })
      seen.push(...page.objects.map((o) => o.path))
      if (page.nextCursor === null) {
        break
      }
      after = page.nextCursor
    }
    expect(seen).toEqual(['k/a', 'k/c', 'k/e'])
  }, 30_000)

  test('a non-ASCII prefix lists correctly via the starts_with backstop', async () => {
    const main = await defaultBranch(projectId)
    await writeObject(projectId, main.id, '😀/x', 1)
    await writeObject(projectId, main.id, '😀/y', 2)
    await writeObject(projectId, main.id, 'z/other', 3)
    const res = await listObjects(h.ctx, main.ancestry, '😀/', { limit: 100 })
    expect(res.objects.map((o) => o.path)).toEqual(['😀/x', '😀/y'])
  }, 20_000)

  test('a non-uuid ancestry element is rejected (cast-safe, no injection)', async () => {
    await expect(resolveObject(h.ctx, ["x'); DROP TABLE storage_objects;--"], 'a')).rejects.toThrow()
  })
})
