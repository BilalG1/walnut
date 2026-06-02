import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { parseArgs } from '../src/args.ts'
import { run, type CliIO } from '../src/cli.ts'
import { networkError, respond } from '../src/client.ts'
import { deleteCredentials, readCredentials, writeCredentials } from '../src/credentials.ts'
import { EXIT, httpStatusToExit } from '../src/exit.ts'
import { formatJson } from '../src/output.ts'

// A temp home with no credentials file — exercises every non-network path, including
// "not logged in". Login/logout file behavior is covered by the e2e suite.
let home: string
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'walnut-cli-unit-'))
})
afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

function io(): CliIO {
  return { homeDir: home, readStdin: async () => '' }
}

function parseErr(stderr: string): { error: string; message: string } {
  return JSON.parse(stderr) as { error: string; message: string }
}

describe('parseArgs', () => {
  test('positionals and value/boolean flags', () => {
    const p = parseArgs(['scope', 'request', 'db:read', 'db:write', '--reason', 'seed', '--pretty'])
    expect(p.error).toBeUndefined()
    expect(p.positionals).toEqual(['scope', 'request', 'db:read', 'db:write'])
    expect(p.options.reason).toBe('seed')
    expect(p.options.pretty).toBe(true)
  })

  test('--flag=value form', () => {
    const p = parseArgs(['db', 'query', '--api-url=http://x:1'])
    expect(p.options['api-url']).toBe('http://x:1')
  })

  test('a lone "-" is a positional, not a flag', () => {
    const p = parseArgs(['db', 'query', '-'])
    expect(p.error).toBeUndefined()
    expect(p.positionals).toEqual(['db', 'query', '-'])
  })

  test('everything after "--" is positional', () => {
    const p = parseArgs(['db', 'query', '--', '--weird'])
    expect(p.positionals).toEqual(['db', 'query', '--weird'])
  })

  test('-h maps to help', () => {
    expect(parseArgs(['-h']).options.help).toBe(true)
  })

  test('unknown flag is an error', () => {
    expect(parseArgs(['--frob']).error).toContain('Unknown flag')
  })

  test('value flag without a value is an error', () => {
    expect(parseArgs(['--reason']).error).toContain('needs a value')
  })
})

describe('httpStatusToExit', () => {
  test('maps statuses to the exit-code contract', () => {
    expect(httpStatusToExit(200)).toBe(EXIT.OK)
    expect(httpStatusToExit(401)).toBe(EXIT.AUTH)
    expect(httpStatusToExit(403)).toBe(EXIT.SCOPE)
    expect(httpStatusToExit(400)).toBe(EXIT.REJECTED)
    expect(httpStatusToExit(409)).toBe(EXIT.REJECTED)
    expect(httpStatusToExit(404)).toBe(EXIT.REJECTED)
    expect(httpStatusToExit(500)).toBe(EXIT.UNEXPECTED)
  })
})

describe('formatJson', () => {
  test('compact by default, indented when pretty', () => {
    expect(formatJson({ a: 1 }, false)).toBe('{"a":1}')
    expect(formatJson({ a: 1 }, true)).toBe('{\n  "a": 1\n}')
  })
})

describe('run — help and version (no network)', () => {
  test('no args prints help on stdout, exit 0', async () => {
    const r = await run([], io())
    expect(r.code).toBe(EXIT.OK)
    expect(r.stdout).toContain('USAGE')
    expect(r.stderr).toBe('')
  })

  test('--version prints the version, exit 0', async () => {
    const r = await run(['--version'], io())
    expect(r.code).toBe(EXIT.OK)
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('db --help and scope --help print to stdout', async () => {
    expect((await run(['db', '--help'], io())).stdout).toContain('walnut db query')
    expect((await run(['scope', '-h'], io())).stdout).toContain('walnut scope request')
  })
})

describe('run — usage errors (no network)', () => {
  test('unknown command → exit 2 with structured error', async () => {
    const r = await run(['frobnicate'], io())
    expect(r.code).toBe(EXIT.USAGE)
    expect(parseErr(r.stderr).error).toBe('unknown_command')
  })

  test('unknown flag → exit 2', async () => {
    const r = await run(['--frob'], io())
    expect(r.code).toBe(EXIT.USAGE)
    expect(parseErr(r.stderr).error).toBe('usage')
  })

  test('db query with no SQL → exit 2', async () => {
    const r = await run(['db', 'query'], io())
    expect(r.code).toBe(EXIT.USAGE)
    expect(parseErr(r.stderr).message).toContain('needs SQL')
  })

  test('db with no subcommand → exit 2', async () => {
    expect((await run(['db'], io())).code).toBe(EXIT.USAGE)
  })

  test('scope request with no scopes → exit 2', async () => {
    const r = await run(['scope', 'request'], io())
    expect(r.code).toBe(EXIT.USAGE)
    expect(parseErr(r.stderr).message).toContain('at least one scope')
  })

  test('db query "-" with empty stdin → exit 2', async () => {
    const r = await run(['db', 'query', '-'], io())
    expect(r.code).toBe(EXIT.USAGE)
    expect(parseErr(r.stderr).message).toContain('empty stdin')
  })
})

describe('respond / networkError (transport mapping)', () => {
  test('success → JSON on stdout, exit 0', () => {
    const r = respond({ data: { ok: 1 }, error: null, status: 200 }, false)
    expect(r.code).toBe(EXIT.OK)
    expect(r.stdout).toBe('{"ok":1}')
    expect(r.stderr).toBe('')
  })

  test('API error body passes through to stderr verbatim, mapped to an exit code', () => {
    const body = { error: 'insufficient_scope', message: 'm', missingScopes: ['db:read'] }
    const r = respond({ data: null, error: { status: 403, value: body }, status: 403 }, false)
    expect(r.code).toBe(EXIT.SCOPE)
    expect(JSON.parse(r.stderr)).toEqual(body)
    expect(r.stdout).toBe('')
  })

  test('no status (never reached the server) → network, exit 7', () => {
    const r = respond({ data: null, error: null }, false)
    expect(r.code).toBe(EXIT.NETWORK)
    expect(JSON.parse(r.stderr).error).toBe('network')
  })

  test('networkError → exit 7 with the thrown message', () => {
    const r = networkError(new Error('connect ECONNREFUSED'), false)
    expect(r.code).toBe(EXIT.NETWORK)
    const body = JSON.parse(r.stderr)
    expect(body.error).toBe('network')
    expect(body.message).toContain('ECONNREFUSED')
  })
})

describe('run — config (no network)', () => {
  test('a command needing auth with no credentials → exit 3, points at walnut login', async () => {
    const r = await run(['whoami'], io())
    expect(r.code).toBe(EXIT.AUTH)
    const body = parseErr(r.stderr)
    expect(body.error).toBe('not_logged_in')
    expect(body.message).toContain('walnut login')
  })
})

describe('credentials (file round-trip)', () => {
  test('write → read → delete', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'walnut-cli-creds-'))
    try {
      expect(await readCredentials(dir)).toBeNull()

      await writeCredentials(dir, { apiKey: 'wln_agt_abc', apiUrl: 'https://x.example' })
      expect(await readCredentials(dir)).toEqual({ apiKey: 'wln_agt_abc', apiUrl: 'https://x.example' })

      expect(await deleteCredentials(dir)).toBe(true)
      expect(await readCredentials(dir)).toBeNull()
      // deleting again is a no-op, not an error.
      expect(await deleteCredentials(dir)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
