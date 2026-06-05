import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createCliHarness, type CliHarness } from './harness.ts'

let h: CliHarness

beforeAll(async () => {
  h = await createCliHarness()
}, 30_000)
afterAll(async () => {
  await h.dispose()
}, 30_000)
beforeEach(async () => {
  await h.reset()
}, 15_000)

// Tests assert on the parsed JSON contract, so a typed-as-any parse is fine here.
function parse(s: string): any {
  return JSON.parse(s)
}

/** Write a temp local file under the harness home dir and return its path. */
async function tempFile(name: string, content: string): Promise<string> {
  const path = join(h.homeDir, name)
  await Bun.write(path, content)
  return path
}

describe('storage cp / ls / cat / stat / rm', () => {
  test('cp uploads a local file; ls/stat/cat then read it back', async () => {
    const { key } = await h.makeAgent({ scopes: ['storage:read', 'storage:write'] })
    const src = await tempFile('hello.txt', 'hello cli storage 🌰')

    const up = await h.run(['storage', 'cp', src, 'walnut://docs/hello.txt'], { key })
    expect(up.code).toBe(0)
    expect(parse(up.stdout).path).toBe('docs/hello.txt')

    const ls = await h.run(['storage', 'ls', 'docs/'], { key })
    expect(ls.code).toBe(0)
    expect(parse(ls.stdout).objects.map((o: { path: string }) => o.path)).toEqual(['docs/hello.txt'])

    const stat = await h.run(['storage', 'stat', 'docs/hello.txt'], { key })
    expect(stat.code).toBe(0)
    expect(parse(stat.stdout).path).toBe('docs/hello.txt')

    const cat = await h.run(['storage', 'cat', 'docs/hello.txt'], { key })
    expect(cat.code).toBe(0)
    expect(cat.stdout).toBe('hello cli storage 🌰')
  }, 30_000)

  test('cp downloads an object to a local file with identical bytes', async () => {
    const { key } = await h.makeAgent({ scopes: ['storage:read', 'storage:write'] })
    const src = await tempFile('orig.txt', 'round trip content')
    await h.run(['storage', 'cp', src, 'walnut://x/y.txt'], { key })

    const dst = join(h.homeDir, 'downloaded.txt')
    const dl = await h.run(['storage', 'cp', 'walnut://x/y.txt', dst], { key })
    expect(dl.code).toBe(0)
    expect(parse(dl.stdout).to).toBe(dst)
    expect(await Bun.file(dst).text()).toBe('round trip content')
  }, 30_000)

  test('rm deletes an object; stat then reports it gone (exit 5)', async () => {
    const { key } = await h.makeAgent({ scopes: ['storage:read', 'storage:write', 'storage:delete'] })
    const src = await tempFile('gone.txt', 'bye')
    await h.run(['storage', 'cp', src, 'walnut://gone.txt'], { key })

    const rm = await h.run(['storage', 'rm', 'gone.txt'], { key })
    expect(rm.code).toBe(0)
    expect(parse(rm.stdout)).toEqual({ path: 'gone.txt', deleted: true })

    const stat = await h.run(['storage', 'stat', 'gone.txt'], { key })
    expect(stat.code).toBe(5) // REJECTED (404)
  }, 30_000)

  test('identical content dedups: a second cp of the same bytes still succeeds', async () => {
    const { key } = await h.makeAgent({ scopes: ['storage:read', 'storage:write'] })
    const a = await tempFile('a.txt', 'same content')
    const b = await tempFile('b.txt', 'same content')
    expect((await h.run(['storage', 'cp', a, 'walnut://first'], { key })).code).toBe(0)
    const second = await h.run(['storage', 'cp', b, 'walnut://second'], { key })
    expect(second.code).toBe(0)
    expect((await h.run(['storage', 'stat', 'second'], { key })).code).toBe(0)
  }, 30_000)
})

describe('storage scope enforcement + usage', () => {
  test('without storage:read, ls exits 4 (scope) with a machine-readable body', async () => {
    const { key } = await h.makeAgent({ scopes: [] })
    const ls = await h.run(['storage', 'ls'], { key })
    expect(ls.code).toBe(4)
    expect(parse(ls.stderr).missingScopes).toEqual(['storage:read'])
  })

  test('without storage:write, cp upload exits 4 (scope)', async () => {
    const { key } = await h.makeAgent({ scopes: ['storage:read'] })
    const src = await tempFile('nope.txt', 'x')
    const up = await h.run(['storage', 'cp', src, 'walnut://nope.txt'], { key })
    expect(up.code).toBe(4)
    expect(parse(up.stderr).missingScopes).toEqual(['storage:write'])
  })

  test('cp with two local paths (no walnut://) is a usage error (exit 2)', async () => {
    const { key } = await h.makeAgent({ scopes: ['storage:write'] })
    const res = await h.run(['storage', 'cp', './a', './b'], { key })
    expect(res.code).toBe(2)
  })

  test('an unknown storage subcommand is a usage error (exit 2)', async () => {
    const { key } = await h.makeAgent({ scopes: [] })
    const res = await h.run(['storage', 'frobnicate'], { key })
    expect(res.code).toBe(2)
  })

  test('storage --help lists the subcommands without hitting the network', async () => {
    const res = await h.run(['storage', '--help'])
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('walnut storage')
    expect(res.stdout).toContain('cp <local> walnut://')
  })
})
