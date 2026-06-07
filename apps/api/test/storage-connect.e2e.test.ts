import { describe, expect, test } from 'bun:test'
import { RESOURCE_LIMITS } from '@walnut/core'
import { bearer, type ErrorBody, h, ms, newProject, useHarness } from './support.ts'

useHarness()

function sha256(bytes: Uint8Array<ArrayBuffer>): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

const enc = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s))

/** Mint an owner-level storage token via the dashboard route; returns the one-time secret + view. */
async function mintToken(projectId: string, branch = 'main', label = 'app') {
  const res = await h.api.api.projects({ id: projectId }).branches({ branch }).storage.tokens.post({ label })
  if (res.data === null) {
    throw new Error(`mint token failed: ${JSON.stringify(res.error?.value)}`)
  }
  return res.data
}

/** Drive the two-phase write end to end over the `/storage/v1` (token-authed) surface. */
async function putViaToken(
  token: string,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  opts: { contentType?: string } = {},
): Promise<void> {
  const res = await h.api.storage.v1.upload.post(
    {
      path,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      ...(opts.contentType === undefined ? {} : { contentType: opts.contentType }),
    },
    { headers: bearer(token) },
  )
  if (res.data === null) {
    throw new Error(`upload failed: ${JSON.stringify(res.error?.value)}`)
  }
  if (res.data.status === 'committed') {
    return
  }
  const uploaded = await fetch(res.data.url, { method: 'PUT', body: bytes })
  if (!uploaded.ok) {
    throw new Error(`PUT to presigned URL failed: ${uploaded.status}`)
  }
  const committed = await h.api.storage.v1.commit.post({ path }, { headers: bearer(token) })
  if (committed.data === null) {
    throw new Error(`commit failed: ${JSON.stringify(committed.error?.value)}`)
  }
}

describe('storage connect — token lifecycle (dashboard)', () => {
  test('mint returns the secret once; the list never carries it', async () => {
    const project = await newProject('connect')
    const minted = await mintToken(project.id, 'main', 'prod app')
    // The secret is returned exactly once, looks like a storage token, and the prefix is non-secret.
    expect(minted.token).toMatch(/^wln_st_[0-9a-f]+$/)
    expect(minted.label).toBe('prod app')
    expect(minted.keyPrefix).toBe(minted.token.slice(0, 12))
    expect(minted.lastUsedAt).toBeNull()

    const list = await h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.tokens.get()
    expect(list.data?.length).toBe(1)
    // The list view never includes the plaintext secret — only its prefix.
    expect(JSON.stringify(list.data)).not.toContain(minted.token)
    expect(list.data?.[0]?.keyPrefix).toBe(minted.keyPrefix)
  })

  test('using a token stamps lastUsedAt', async () => {
    const project = await newProject('connect')
    const minted = await mintToken(project.id)
    await h.api.storage.v1.ls.get({ query: {}, headers: bearer(minted.token) })
    const list = await h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.tokens.get()
    expect(list.data?.[0]?.lastUsedAt).not.toBeNull()
    expect(ms(list.data?.[0]?.lastUsedAt)).toBeGreaterThan(0)
  })

  test('per-branch token cap is enforced', async () => {
    const project = await newProject('connect')
    for (let i = 0; i < RESOURCE_LIMITS.storageTokensPerBranch; i++) {
      // Sequential by design: the cap is count-then-insert, so the requests must not race.
      // eslint-disable-next-line no-await-in-loop
      await mintToken(project.id, 'main', `app-${i}`)
    }
    const over = await h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.tokens.post({
      label: 'one too many',
    })
    expect(over.status).toBe(403)
    expect((over.error?.value as ErrorBody | undefined)?.limit).toBe('storage_tokens_per_branch')
  })
})

describe('storage connect — the /storage/v1 surface', () => {
  test('full roundtrip: upload → ls → stat → download round-trips the bytes', async () => {
    const project = await newProject('connect')
    const { token } = await mintToken(project.id)
    const bytes = enc('hello from my own app 🚀')
    await putViaToken(token, 'docs/readme.txt', bytes, { contentType: 'text/plain' })

    const ls = await h.api.storage.v1.ls.get({ query: { prefix: 'docs/' }, headers: bearer(token) })
    expect(ls.data?.objects.map((o) => o.path)).toEqual(['docs/readme.txt'])

    const st = await h.api.storage.v1.stat.get({ query: { path: 'docs/readme.txt' }, headers: bearer(token) })
    expect(st.data?.size).toBe(bytes.byteLength)
    expect(st.data?.contentType).toBe('text/plain')

    const dl = await h.api.storage.v1.download.get({ query: { path: 'docs/readme.txt' }, headers: bearer(token) })
    const fetched = await fetch(dl.data?.url ?? '')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes)
  }, 30_000)

  test('a token can delete (tombstone) an object it wrote — write + delete verbs are wired', async () => {
    const project = await newProject('connect')
    const { token } = await mintToken(project.id)
    await putViaToken(token, 'tmp/scratch.txt', enc('disposable'))
    // Present before delete.
    const before = await h.api.storage.v1.stat.get({ query: { path: 'tmp/scratch.txt' }, headers: bearer(token) })
    expect(before.status).toBe(200)
    // Delete over /storage/v1, then it's gone from the branch's view.
    const del = await h.api.storage.v1.delete.post({ path: 'tmp/scratch.txt' }, { headers: bearer(token) })
    expect(del.data).toEqual({ path: 'tmp/scratch.txt', deleted: true })
    const after = await h.api.storage.v1.stat.get({ query: { path: 'tmp/scratch.txt' }, headers: bearer(token) })
    expect(after.status).toBe(404)
  }, 30_000)

  test('objects written via a token are visible in the dashboard storage browser (same store)', async () => {
    const project = await newProject('connect')
    const { token } = await mintToken(project.id)
    await putViaToken(token, 'shared.txt', enc('via token'))
    // The dashboard browser (org-membership auth) sees the same object — not a divergent world.
    const dash = await h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.ls.get({ query: {} })
    expect(dash.data?.objects.map((o) => o.path)).toContain('shared.txt')
  }, 30_000)

  test('a token is pinned to its branch — it cannot see another branch’s objects', async () => {
    const project = await newProject('connect')
    const feature = await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature', from: 'main' })
    expect(feature.status).toBe(200)
    const featureToken = (await mintToken(project.id, 'feature')).token
    const mainToken = (await mintToken(project.id, 'main')).token

    await putViaToken(featureToken, 'only-on-feature.txt', enc('feature bytes'))

    // The feature token sees its own write; the main token (an ancestor branch) does not.
    const onFeature = await h.api.storage.v1.ls.get({ query: {}, headers: bearer(featureToken) })
    expect(onFeature.data?.objects.map((o) => o.path)).toContain('only-on-feature.txt')
    const onMain = await h.api.storage.v1.ls.get({ query: {}, headers: bearer(mainToken) })
    expect(onMain.data?.objects.map((o) => o.path)).not.toContain('only-on-feature.txt')
  }, 30_000)
})

describe('storage connect — authentication & revocation', () => {
  test('missing and invalid tokens are 401', async () => {
    const missing = await h.api.storage.v1.ls.get({ query: {}, headers: { authorization: '' } })
    expect(missing.status).toBe(401)
    const invalid = await h.api.storage.v1.ls.get({ query: {}, headers: bearer('wln_st_deadbeef') })
    expect(invalid.status).toBe(401)
  })

  test('revoking a token immediately stops it authenticating', async () => {
    const project = await newProject('connect')
    const minted = await mintToken(project.id)
    // Works before revoke.
    const before = await h.api.storage.v1.ls.get({ query: {}, headers: bearer(minted.token) })
    expect(before.status).toBe(200)

    const del = await h.api.api
      .projects({ id: project.id })
      .branches({ branch: 'main' })
      .storage.tokens({ tokenId: minted.id })
      .delete()
    expect(del.status).toBe(200)

    const after = await h.api.storage.v1.ls.get({ query: {}, headers: bearer(minted.token) })
    expect(after.status).toBe(401)
  })
})

describe('storage connect — dashboard authorization', () => {
  test('a non-member cannot mint, list, or revoke tokens on another user’s project', async () => {
    const project = await newProject('connect')
    const minted = await mintToken(project.id)
    const stranger = await h.clientFor('11111111-1111-4111-8111-111111111111', { email: 'stranger@example.com' })

    const list = await stranger.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.tokens.get()
    expect(list.status).toBe(404)
    const create = await stranger.api
      .projects({ id: project.id })
      .branches({ branch: 'main' })
      .storage.tokens.post({ label: 'sneaky' })
    expect(create.status).toBe(404)
    const del = await stranger.api
      .projects({ id: project.id })
      .branches({ branch: 'main' })
      .storage.tokens({ tokenId: minted.id })
      .delete()
    expect(del.status).toBe(404)
  })
})
