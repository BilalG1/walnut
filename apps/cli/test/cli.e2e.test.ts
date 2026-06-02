import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { readCredentials } from '../src/credentials.ts'
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

describe('whoami', () => {
  test('returns identity + project, exit 0', async () => {
    const { projectId, key } = await h.makeAgent()
    const r = await h.run(['whoami'], { key })
    expect(r.code).toBe(0)
    const out = parse(r.stdout)
    expect(out.project.id).toBe(projectId)
    expect(out.scopes).toEqual([])
  })

  test('invalid key → exit 3 (auth), error body on stderr', async () => {
    await h.makeAgent()
    const r = await h.run(['whoami'], { key: 'wln_agt_nope' })
    expect(r.code).toBe(3)
    expect(parse(r.stderr).error).toBe('unauthorized')
  })

  test('not logged in → exit 3 pointing at walnut login', async () => {
    const r = await h.run(['whoami'])
    expect(r.code).toBe(3)
    const body = parse(r.stderr)
    expect(body.error).toBe('not_logged_in')
    expect(body.message).toContain('walnut login')
  })
})

describe('login / logout', () => {
  test('login stores credentials that later commands use, then logout clears them', async () => {
    const { projectId, key } = await h.makeAgent()

    const loggedIn = await h.run(['login', '--api-key', key])
    expect(loggedIn.code).toBe(0)
    expect(parse(loggedIn.stdout).loggedIn).toBe(true)
    expect((await readCredentials(h.homeDir))?.apiKey).toBe(key)

    // whoami with no flag now resolves the stored key.
    const who = await h.run(['whoami'])
    expect(who.code).toBe(0)
    expect(parse(who.stdout).project.id).toBe(projectId)

    const loggedOut = await h.run(['logout'])
    expect(loggedOut.code).toBe(0)
    expect(parse(loggedOut.stdout).loggedOut).toBe(true)
    expect(await readCredentials(h.homeDir)).toBeNull()

    // and now we're unauthenticated again.
    expect((await h.run(['whoami'])).code).toBe(3)
  })

  test('login persists a custom --api-url', async () => {
    await h.run(['login', '--api-key', 'wln_agt_x', '--api-url', 'https://walnut.example.com'])
    const creds = await readCredentials(h.homeDir)
    expect(creds?.apiUrl).toBe('https://walnut.example.com')
  })

  test('login without --api-key → exit 2', async () => {
    const r = await h.run(['login'])
    expect(r.code).toBe(2)
  })
})

describe('db query', () => {
  test('a granted read returns rows, exit 0', async () => {
    const { key } = await h.makeAgent({ scopes: ['db:read'] })
    const r = await h.run(['db', 'query', 'select 1 as n'], { key })
    expect(r.code).toBe(0)
    const out = parse(r.stdout)
    expect(out.rowCount).toBe(1)
    expect(out.rows).toEqual([{ n: 1 }])
  })

  test('insufficient scope → exit 4 with the machine-readable body intact', async () => {
    const { key } = await h.makeAgent()
    const r = await h.run(['db', 'query', 'select 1'], { key })
    expect(r.code).toBe(4)
    const body = parse(r.stderr)
    expect(body.error).toBe('insufficient_scope')
    expect(body.missingScopes).toEqual(['db:read'])
    expect(typeof body.howToRequest).toBe('string')
  })

  test('SQL from stdin via "-"', async () => {
    const { key } = await h.makeAgent({ scopes: ['db:read'] })
    const r = await h.run(['db', 'query', '-'], { key, stdin: 'select 2 as n' })
    expect(r.code).toBe(0)
    expect(parse(r.stdout).rows).toEqual([{ n: 2 }])
  })

  test('a SQL error → exit 5 (rejected)', async () => {
    const { key } = await h.makeAgent({ scopes: ['db:read'] })
    const r = await h.run(['db', 'query', 'select * from nope_table'], { key })
    expect(r.code).toBe(5)
    expect(parse(r.stderr).error).toBe('query_error')
  })
})

describe('scope', () => {
  test('scope request opens a pending request, exit 0', async () => {
    const { key } = await h.makeAgent()
    const r = await h.run(['scope', 'request', 'db:read', 'db:write', '--reason', 'seed'], { key })
    expect(r.code).toBe(0)
    const out = parse(r.stdout)
    expect(out.status).toBe('pending')
    expect(out.scopes).toEqual(['db:read', 'db:write'])
    expect(out.reason).toBe('seed')
  })

  test('scope ls shows granted scopes and the request log', async () => {
    const { key } = await h.makeAgent({ scopes: ['db:read'] })
    await h.run(['scope', 'request', 'db:write'], { key })
    const r = await h.run(['scope', 'ls'], { key })
    expect(r.code).toBe(0)
    const out = parse(r.stdout)
    expect(out.granted).toEqual(['db:read'])
    expect(out.requests.length).toBeGreaterThanOrEqual(1)
  })

  test('requesting an unknown scope → exit 5', async () => {
    const { key } = await h.makeAgent()
    const r = await h.run(['scope', 'request', 'db:teleport'], { key })
    expect(r.code).toBe(5)
  })
})

// The real from-source binary, for paths that never touch the network — this proves
// index.ts wires stdin/stdout/stderr and process.exit correctly.
describe('binary smoke (subprocess)', () => {
  test('--help prints usage to stdout, exit 0', async () => {
    const r = await h.spawn(['--help'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('USAGE')
  })

  test('--version prints the version, exit 0', async () => {
    const r = await h.spawn(['--version'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('not logged in → exit 3 on stderr', async () => {
    const r = await h.spawn(['whoami'])
    expect(r.code).toBe(3)
    expect(JSON.parse(r.stderr).error).toBe('not_logged_in')
  })

  test('unknown command → exit 2', async () => {
    const r = await h.spawn(['frobnicate'])
    expect(r.code).toBe(2)
  })

  test('the real binary writes and removes the credentials file', async () => {
    const login = await h.spawn(['login', '--api-key', 'wln_agt_binary', '--api-url', 'https://x.example'])
    expect(login.code).toBe(0)
    expect(JSON.parse(login.stdout).loggedIn).toBe(true)
    expect((await readCredentials(h.homeDir))?.apiKey).toBe('wln_agt_binary')

    const logout = await h.spawn(['logout'])
    expect(logout.code).toBe(0)
    expect(await readCredentials(h.homeDir)).toBeNull()
  })
})
