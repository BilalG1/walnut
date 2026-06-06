import { describe, expect, test } from 'bun:test'
import { STORAGE_LIMITS } from '@walnut/core'
import { branches, physicalObjects, storageObjects } from '@walnut/db'
import { eq } from 'drizzle-orm'
import { bearer, type ErrorBody, grantResource, h, newAgent, newProject, useHarness } from './support.ts'

useHarness()

function sha256(bytes: Uint8Array<ArrayBuffer>): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

/** Drive the two-phase write end to end: presign (or dedup-commit), PUT the bytes, commit. */
async function put(
  apiKey: string,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  opts: { branch?: string; contentType?: string } = {},
): Promise<void> {
  const body = {
    path,
    sha256: sha256(bytes),
    size: bytes.byteLength,
    ...(opts.contentType === undefined ? {} : { contentType: opts.contentType }),
    ...(opts.branch === undefined ? {} : { branch: opts.branch }),
  }
  const res = await h.api.agent.v1.storage.upload.post(body, { headers: bearer(apiKey) })
  if (res.data === null) {
    throw new Error(`upload failed: ${JSON.stringify(res.error?.value)}`)
  }
  if (res.data.status === 'committed') {
    return // dedup hit — bytes already present, nothing to upload
  }
  const uploaded = await fetch(res.data.url, { method: 'PUT', body: bytes })
  if (!uploaded.ok) {
    throw new Error(`PUT to presigned URL failed: ${uploaded.status}`)
  }
  const committed = await h.api.agent.v1.storage.commit.post(
    { path, ...(opts.branch === undefined ? {} : { branch: opts.branch }) },
    { headers: bearer(apiKey) },
  )
  if (committed.data === null) {
    throw new Error(`commit failed: ${JSON.stringify(committed.error?.value)}`)
  }
}

const enc = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s))

async function setup(scopes: ('storage:read' | 'storage:write' | 'storage:delete')[]) {
  const project = await newProject('store')
  const agent = await newAgent('store-bot')
  if (scopes.length > 0) {
    await grantResource(agent.apiKey, 'project', project.id, scopes)
  }
  return { project, agent }
}

describe('storage — full roundtrip', () => {
  test('upload → download → stat → ls round-trips the bytes through presigned URLs', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const bytes = enc('hello walnut storage 🌰')
    await put(agent.apiKey, 'docs/hello.txt', bytes, { contentType: 'text/plain' })

    // Download: the API hands back a presigned GET; the bytes come straight from the store.
    const dl = await h.api.agent.v1.storage.download.get({
      query: { path: 'docs/hello.txt' },
      headers: bearer(agent.apiKey),
    })
    expect(dl.status).toBe(200)
    expect(dl.data?.size).toBe(bytes.byteLength)
    expect(dl.data?.contentType).toBe('text/plain')
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes)
    // The download is named by its logical base name, not the content-hash physical key (F3-a):
    // the presigned GET carries a signed Content-Disposition that the store echoes back.
    expect(fetched.headers.get('content-disposition')).toContain('filename="hello.txt"')

    // Stat: metadata only.
    const st = await h.api.agent.v1.storage.stat.get({
      query: { path: 'docs/hello.txt' },
      headers: bearer(agent.apiKey),
    })
    expect(st.data?.size).toBe(bytes.byteLength)

    // List under the prefix.
    const ls = await h.api.agent.v1.storage.ls.get({ query: { prefix: 'docs/' }, headers: bearer(agent.apiKey) })
    expect(ls.data?.objects.map((o) => o.path)).toEqual(['docs/hello.txt'])
  }, 30_000)

  test('a physical key is NEVER a structured field, and metadata responses never leak the key', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    await put(agent.apiKey, 'secret.bin', enc('xyz'))
    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'secret.bin' }, headers: bearer(agent.apiKey) })
    const ls = await h.api.agent.v1.storage.ls.get({ query: {}, headers: bearer(agent.apiKey) })
    const dl = await h.api.agent.v1.storage.download.get({ query: { path: 'secret.bin' }, headers: bearer(agent.apiKey) })
    // No response ever carries a `physicalKey` field — agents address objects only by (branch, path).
    for (const blob of [JSON.stringify(st.data), JSON.stringify(ls.data), JSON.stringify(dl.data)]) {
      expect(blob).not.toContain('physicalKey')
    }
    // stat/ls (pure metadata) never leak the key path. The download URL legitimately contains it
    // (a presigned URL points AT the object) but is single-object and short-TTL.
    expect(JSON.stringify(st.data)).not.toContain('/blobs/')
    expect(JSON.stringify(ls.data)).not.toContain('/blobs/')
  }, 30_000)
})

describe('storage — scope enforcement (the sole authorization layer)', () => {
  test('without storage:write, upload is 403 with a machine-readable scope body', async () => {
    const { agent } = await setup(['storage:read'])
    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'x', sha256: sha256(enc('x')), size: 1 },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('insufficient_scope')
    expect(body?.missingScopes).toEqual(['storage:write'])
  })

  test('without storage:read, list/stat/download are all 403', async () => {
    const { agent } = await setup(['storage:write'])
    await put(agent.apiKey, 'a', enc('a'))
    const ls = await h.api.agent.v1.storage.ls.get({ query: {}, headers: bearer(agent.apiKey) })
    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'a' }, headers: bearer(agent.apiKey) })
    const dl = await h.api.agent.v1.storage.download.get({ query: { path: 'a' }, headers: bearer(agent.apiKey) })
    expect([ls.status, st.status, dl.status]).toEqual([403, 403, 403])
  }, 30_000)

  test('without storage:delete, delete is 403', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    await put(agent.apiKey, 'a', enc('a'))
    const res = await h.api.agent.v1.storage.delete.post({ path: 'a' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(403)
    expect((res.error?.value as ErrorBody | undefined)?.missingScopes).toEqual(['storage:delete'])
  }, 30_000)

  test('an agent with no grants at all gets 403 (storage is gated like db:*)', async () => {
    const { agent } = await setup([])
    const res = await h.api.agent.v1.storage.ls.get({ query: {}, headers: bearer(agent.apiKey) })
    expect(res.status).toBe(403)
  })
})

describe('storage — instant branching', () => {
  test('a file written on main is readable from a freshly forked branch (inherited, O(1) branch)', async () => {
    const { project, agent } = await setup(['storage:read', 'storage:write'])
    const bytes = enc('inherited content')
    await put(agent.apiKey, 'shared/data.bin', bytes)

    // Fork a branch — a metadata-only O(1) operation; no objects are copied.
    const br = await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })
    expect(br.status).toBe(200)

    // The new branch sees the inherited file and can download the very same bytes.
    const st = await h.api.agent.v1.storage.stat.get({
      query: { path: 'shared/data.bin', branch: 'feature' },
      headers: bearer(agent.apiKey),
    })
    expect(st.data?.size).toBe(bytes.byteLength)
    const dl = await h.api.agent.v1.storage.download.get({
      query: { path: 'shared/data.bin', branch: 'feature' },
      headers: bearer(agent.apiKey),
    })
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes)
  }, 30_000)

  test('deleting an inherited file on a branch tombstones it there but not on the parent', async () => {
    const { project, agent } = await setup(['storage:read', 'storage:write', 'storage:delete'])
    await put(agent.apiKey, 'f.txt', enc('parent'))
    await h.api.api.projects({ id: project.id }).branches.post({ name: 'b' })

    const del = await h.api.agent.v1.storage.delete.post(
      { path: 'f.txt', branch: 'b' },
      { headers: bearer(agent.apiKey) },
    )
    expect(del.data).toEqual({ path: 'f.txt', deleted: true })

    // Gone on the branch…
    const onBranch = await h.api.agent.v1.storage.stat.get({
      query: { path: 'f.txt', branch: 'b' },
      headers: bearer(agent.apiKey),
    })
    expect(onBranch.status).toBe(404)
    // …still present on main.
    const onMain = await h.api.agent.v1.storage.stat.get({ query: { path: 'f.txt' }, headers: bearer(agent.apiKey) })
    expect(onMain.status).toBe(200)
  }, 30_000)
})

describe('storage — dedup, delete, commit, limits', () => {
  test('identical bytes dedup: the second upload commits immediately, no PUT needed', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const bytes = enc('same bytes')
    await put(agent.apiKey, 'first', bytes)
    // A second upload of the same content hashes to the same key → server reports it's already stored.
    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'second', sha256: sha256(bytes), size: bytes.byteLength },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.data?.status).toBe('committed')
    // And it's readable without a separate commit step.
    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'second' }, headers: bearer(agent.apiKey) })
    expect(st.data?.size).toBe(bytes.byteLength)
  }, 30_000)

  test('committing without uploading the bytes is a 409', async () => {
    const { agent } = await setup(['storage:write'])
    const bytes = enc('never uploaded')
    const up = await h.api.agent.v1.storage.upload.post(
      { path: 'ghost', sha256: sha256(bytes), size: bytes.byteLength },
      { headers: bearer(agent.apiKey) },
    )
    expect(up.data?.status).toBe('upload') // a real presign, not a dedup
    const res = await h.api.agent.v1.storage.commit.post({ path: 'ghost' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(409)
    expect((res.error?.value as ErrorBody | undefined)?.error).toBe('upload_missing')
  }, 30_000)

  test('deleting a non-existent path is 404', async () => {
    const { agent } = await setup(['storage:delete', 'storage:read'])
    const res = await h.api.agent.v1.storage.delete.post({ path: 'nope' }, { headers: bearer(agent.apiKey) })
    expect(res.status).toBe(404)
  })

  test('an oversized blob is rejected with 403 limit_exceeded before any presign', async () => {
    const { agent } = await setup(['storage:write'])
    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'huge', sha256: 'a'.repeat(64), size: 6 * 1024 * 1024 * 1024 },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('max_blob_bytes')
  })

  test('the per-org owned-bytes backstop trips across branches, not just per-branch', async () => {
    // Two projects share the seeded user's org. Seed a fake org-quota-sized committed object
    // directly on project B's branch (a direct insert bypasses the per-branch cap), then a tiny
    // real upload on project A — whose own branch is empty — must still be refused by the ORG
    // backstop. This exercises the owner→branch→project→org sum that the per-branch check can't see.
    const a = await newProject('orgcap-a')
    const b = await newProject('orgcap-b')
    const agent = await newAgent('orgcap-bot')
    await grantResource(agent.apiKey, 'project', a.id, ['storage:write'])

    const [bBranch] = await h.ctx.db.select({ id: branches.id }).from(branches).where(eq(branches.projectId, b.id)).limit(1)
    if (bBranch === undefined) throw new Error('project B has no branch')
    const key = `${b.id}/blobs/${'b'.repeat(64)}`
    await h.ctx.db.insert(physicalObjects).values({ physicalKey: key, size: STORAGE_LIMITS.maxOwnedBytesPerOrg })
    await h.ctx.db.insert(storageObjects).values({
      ownerBranchId: bBranch.id,
      path: 'big',
      physicalKey: key,
      size: STORAGE_LIMITS.maxOwnedBytesPerOrg,
      state: 'committed',
      deleted: false,
    })

    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'tiny', sha256: 'a'.repeat(64), size: 1 },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(403)
    const body = res.error?.value as ErrorBody | undefined
    expect(body?.error).toBe('limit_exceeded')
    expect(body?.limit).toBe('storage_owned_bytes_per_org')
  })

  test('an invalid sha256 is rejected with 400', async () => {
    const { agent } = await setup(['storage:write'])
    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'bad', sha256: 'not-a-hash', size: 3 },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
  })

  test('a path with a control character is rejected with 400', async () => {
    const { agent } = await setup(['storage:write'])
    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'a\nb', sha256: sha256(enc('x')), size: 1 },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.status).toBe(400)
  })

  // The presigned PUT is unconstrained, so the client's declared size can't be trusted. Commit
  // captures the REAL size via HEAD (and re-enforces the size caps against it).
  test('commit records the real byte size, not the client-declared one', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const bytes = enc('eleven byte') // 11 bytes
    const up = await h.api.agent.v1.storage.upload.post(
      { path: 'sz', sha256: sha256(bytes), size: 1 }, // deliberately wrong (small) declared size
      { headers: bearer(agent.apiKey) },
    )
    if (up.data?.status !== 'upload') {
      throw new Error(`expected a presign, got ${JSON.stringify(up.data ?? up.error?.value)}`)
    }
    const uploaded = await fetch(up.data.url, { method: 'PUT', body: bytes })
    expect(uploaded.ok).toBe(true)
    const committed = await h.api.agent.v1.storage.commit.post({ path: 'sz' }, { headers: bearer(agent.apiKey) })
    expect(committed.data?.size).toBe(bytes.byteLength)
    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'sz' }, headers: bearer(agent.apiKey) })
    expect(st.data?.size).toBe(bytes.byteLength)
  }, 30_000)
})

// A two-phase overwrite must be atomic for READS: the live version stays fully readable until the
// new bytes are committed, and an abandoned overwrite (presign minted, never PUT/committed) must
// leave the original intact. The dangerous case is overwriting a path the branch already OWNS with
// genuinely new (non-dedup) bytes — staging that upload must not touch the committed view.
describe('storage — overwrite atomicity (no data loss mid-overwrite)', () => {
  /** Begin a two-phase overwrite with new bytes but DON'T finish it: returns the presign response. */
  async function beginOverwrite(apiKey: string, path: string, bytes: Uint8Array<ArrayBuffer>) {
    const res = await h.api.agent.v1.storage.upload.post(
      { path, sha256: sha256(bytes), size: bytes.byteLength },
      { headers: bearer(apiKey) },
    )
    return res
  }

  test('an in-flight overwrite keeps the old version fully readable until commit', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const v1 = enc('version one')
    await put(agent.apiKey, 'doc', v1, { contentType: 'text/plain' })

    // Start an overwrite with DIFFERENT (new, not-yet-stored) bytes — presign only, no PUT/commit.
    const v2 = enc('version two — different and longer content')
    const begun = await beginOverwrite(agent.apiKey, 'doc', v2)
    expect(begun.data?.status).toBe('upload') // a real presign for new bytes, not a dedup-commit

    // stat: still the OLD version, intact.
    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    expect(st.status).toBe(200)
    expect(st.data?.size).toBe(v1.byteLength)
    expect(st.data?.contentType).toBe('text/plain')

    // download: still resolves the OLD bytes.
    const dl = await h.api.agent.v1.storage.download.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    expect(dl.status).toBe(200)
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(v1)

    // ls: the object is still listed.
    const ls = await h.api.agent.v1.storage.ls.get({ query: {}, headers: bearer(agent.apiKey) })
    expect(ls.data?.objects.map((o) => o.path)).toContain('doc')
  }, 30_000)

  test('completing the overwrite flips atomically to the new bytes (and content type)', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const v1 = enc('first')
    const v2 = enc('second, replacing the first entirely')
    await put(agent.apiKey, 'doc', v1, { contentType: 'text/plain' })
    await put(agent.apiKey, 'doc', v2, { contentType: 'application/json' }) // full overwrite (presign → PUT → commit)

    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    expect(st.data?.size).toBe(v2.byteLength)
    // The committed content type is replaced by the overwrite's (sourced from the staged columns).
    expect(st.data?.contentType).toBe('application/json')
    const dl = await h.api.agent.v1.storage.download.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(v2)
  }, 30_000)

  test('overwriting via a dedup hit flips atomically, never losing the row', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const v1 = enc('the original doc bytes')
    const shared = enc('bytes that already exist elsewhere in the project')
    await put(agent.apiKey, 'doc', v1)
    await put(agent.apiKey, 'sidecar', shared) // `shared` is now stored in the project

    // Overwrite `doc` with the already-stored bytes → a dedup hit: commits in place (no PUT), which
    // takes the `upsertCommitted` path rather than stage→promote. It must flip atomically.
    const res = await h.api.agent.v1.storage.upload.post(
      { path: 'doc', sha256: sha256(shared), size: shared.byteLength },
      { headers: bearer(agent.apiKey) },
    )
    expect(res.data?.status).toBe('committed') // the dedup-commit path, not a presign

    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    expect(st.status).toBe(200)
    expect(st.data?.size).toBe(shared.byteLength)
    const dl = await h.api.agent.v1.storage.download.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(shared)
  }, 30_000)

  test('an abandoned overwrite leaves the original intact (no durability loss)', async () => {
    const { agent } = await setup(['storage:read', 'storage:write'])
    const v1 = enc('keep me safe')
    await put(agent.apiKey, 'doc', v1)

    // Abandon an overwrite: presign new bytes, then never PUT/commit (e.g. client crash).
    await beginOverwrite(agent.apiKey, 'doc', enc('half-written replacement that never lands'))

    // The original must still be downloadable byte-for-byte.
    const dl = await h.api.agent.v1.storage.download.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    expect(dl.status).toBe(200)
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(v1)
  }, 30_000)

  test('re-uploading a deleted path resurrects it (delete then write round-trips)', async () => {
    const { agent } = await setup(['storage:read', 'storage:write', 'storage:delete'])
    await put(agent.apiKey, 'doc', enc('original'))
    await h.api.agent.v1.storage.delete.post({ path: 'doc' }, { headers: bearer(agent.apiKey) })
    expect((await h.api.agent.v1.storage.stat.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })).status).toBe(404)

    const revived = enc('brought back to life')
    await put(agent.apiKey, 'doc', revived)
    const st = await h.api.agent.v1.storage.stat.get({ query: { path: 'doc' }, headers: bearer(agent.apiKey) })
    expect(st.status).toBe(200)
    expect(st.data?.size).toBe(revived.byteLength)
  }, 30_000)
})
