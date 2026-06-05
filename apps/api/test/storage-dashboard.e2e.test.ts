import { describe, expect, test } from 'bun:test'
import { h, newProject, useHarness } from './support.ts'

useHarness()

function sha256(bytes: Uint8Array<ArrayBuffer>): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}
const enc = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s))

/** Upload through the dashboard (org-membership authed) two-phase write, as the seeded user. */
async function put(projectId: string, branch: string, path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const store = h.api.api.projects({ id: projectId }).branches({ branch }).storage
  const up = await store.upload.post({ path, sha256: sha256(bytes), size: bytes.byteLength })
  if (up.data === null) {
    throw new Error(`dashboard upload failed: ${JSON.stringify(up.error?.value)}`)
  }
  if (up.data.status === 'committed') {
    return
  }
  const uploaded = await fetch(up.data.url, { method: 'PUT', body: bytes })
  if (!uploaded.ok) {
    throw new Error(`PUT failed: ${uploaded.status}`)
  }
  await store.commit.post({ path })
}

describe('dashboard storage (org-membership authed)', () => {
  test('upload → ls → stat → download → delete round-trips for a member', async () => {
    const project = await newProject('dash-store')
    const store = h.api.api.projects({ id: project.id }).branches({ branch: 'main' }).storage
    await put(project.id, 'main', 'reports/q1.txt', enc('quarterly numbers'))

    const ls = await store.ls.get({ query: { prefix: 'reports/' } })
    expect(ls.data?.objects.map((o) => o.path)).toEqual(['reports/q1.txt'])

    const stat = await store.stat.get({ query: { path: 'reports/q1.txt' } })
    expect(stat.data?.size).toBe(enc('quarterly numbers').byteLength)

    const dl = await store.download.get({ query: { path: 'reports/q1.txt' } })
    expect(dl.status).toBe(200)
    const fetched = await fetch(dl.data?.url ?? '')
    expect(await fetched.text()).toBe('quarterly numbers')

    const del = await store.delete.post({ path: 'reports/q1.txt' })
    expect(del.data).toEqual({ path: 'reports/q1.txt', deleted: true })
    expect((await store.stat.get({ query: { path: 'reports/q1.txt' } })).status).toBe(404)
  }, 30_000)

  test('a forked branch inherits the parent\'s objects (instant branch in the dashboard)', async () => {
    const project = await newProject('dash-branch')
    await put(project.id, 'main', 'shared.bin', enc('shared bytes'))
    expect((await h.api.api.projects({ id: project.id }).branches.post({ name: 'feature' })).status).toBe(200)
    const onBranch = await h.api.api
      .projects({ id: project.id })
      .branches({ branch: 'feature' })
      .storage.stat.get({ query: { path: 'shared.bin' } })
    expect(onBranch.data?.size).toBe(enc('shared bytes').byteLength)
  }, 30_000)

  test('a non-member cannot reach a project\'s storage (404)', async () => {
    const project = await newProject('dash-private')
    const outsider = await h.clientFor('99999999-9999-9999-9999-999999999999', { email: 'outsider@x.com' })
    const res = await outsider.api.projects({ id: project.id }).branches({ branch: 'main' }).storage.ls.get({ query: {} })
    expect(res.status).toBe(404)
  })
})
