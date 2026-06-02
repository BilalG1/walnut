import { parseArgs } from './args.ts'
import { type ApiClient, makeClient } from './client.ts'
import { dbQuery, login, logout, projectLs, scopeLs, scopeRequest, whoami } from './commands.ts'
import { resolveConfig } from './config.ts'
import { EXIT } from './exit.ts'
import { authHelp, dbHelp, projectHelp, scopeHelp, topLevelHelp } from './help.ts'
import { fail, type CliResult } from './output.ts'
import { VERSION } from './version.ts'

/** Read a string-valued flag, or undefined when absent/boolean. */
function flag(options: Record<string, string | boolean>, name: string): string | undefined {
  const value = options[name]
  return typeof value === 'string' ? value : undefined
}

const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** Parse a `--ttl` duration into whole seconds. Accepts a unit suffix (`90s`, `30m`,
 * `1h`, `7d`) or a bare integer count of seconds. Returns null on anything malformed
 * or non-positive so the caller can surface a usage error. */
function parseDuration(input: string): number | null {
  const match = /^(\d+)([smhd]?)$/.exec(input.trim())
  if (match === null) {
    return null
  }
  const amount = Number(match[1])
  const unit = match[2] ?? ''
  const seconds = amount * (unit === '' ? 1 : (DURATION_UNITS[unit] ?? 1))
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null
}

/** Injected so the dispatcher stays testable without touching the real process or
 * network. `homeDir` locates the credentials file; tests point it at a temp dir.
 * Tests also pass an in-memory `makeClient` (the sandbox firewall intercepts real
 * fetch, and it lets a command run against a real app without a socket). */
export interface CliIO {
  homeDir: string
  readStdin: () => Promise<string>
  makeClient?: (apiUrl: string, apiKey: string) => ApiClient
}

function help(text: string): CliResult {
  return { stdout: text, stderr: '', code: EXIT.OK }
}

/** Build a client from resolved config, or short-circuit with the config failure. */
async function withClient(
  io: CliIO,
  options: Record<string, string | boolean>,
  pretty: boolean,
  fn: (client: ApiClient) => Promise<CliResult>,
): Promise<CliResult> {
  const config = await resolveConfig(options, io.homeDir, pretty)
  if ('code' in config) {
    return config
  }
  const make = io.makeClient ?? makeClient
  return fn(make(config.apiUrl, config.apiKey))
}

/**
 * Parse argv and run the matching command. Returns a `CliResult` rather than exiting,
 * so it can be unit-tested directly; `index.ts` is the only place that touches
 * stdin/stdout/exit.
 */
export async function run(argv: readonly string[], io: CliIO): Promise<CliResult> {
  const parsed = parseArgs(argv)
  const pretty = parsed.options.pretty === true

  if (parsed.error !== undefined) {
    return fail(EXIT.USAGE, 'usage', parsed.error, pretty, { hint: 'Run `walnut --help`.' })
  }
  if (parsed.options.version === true) {
    return { stdout: VERSION, stderr: '', code: EXIT.OK }
  }

  const [command, sub, ...rest] = parsed.positionals
  const wantsHelp = parsed.options.help === true

  if (command === undefined) {
    return help(topLevelHelp())
  }

  switch (command) {
    case 'whoami':
      if (wantsHelp) return help(topLevelHelp())
      return withClient(io, parsed.options, pretty, (client) => whoami(client, pretty))

    case 'db': {
      if (wantsHelp) return help(dbHelp())
      if (sub === undefined) {
        return fail(EXIT.USAGE, 'usage', 'db needs a subcommand. Try: walnut db query "<sql>".', pretty)
      }
      if (sub !== 'query') {
        return fail(EXIT.USAGE, 'usage', `Unknown db subcommand: ${sub}. Only "query" is supported.`, pretty)
      }
      const sqlArg = rest[0]
      if (sqlArg === undefined) {
        return fail(EXIT.USAGE, 'usage', 'db query needs SQL: a string argument, or "-" to read stdin.', pretty)
      }
      let sql = sqlArg
      if (sqlArg === '-') {
        sql = (await io.readStdin()).trim()
        if (sql === '') {
          return fail(EXIT.USAGE, 'usage', 'db query - was given empty stdin.', pretty)
        }
      }
      // Both optional: the server defaults --project to the agent's sole project and
      // --branch to the project's default branch (main).
      const target = { projectId: flag(parsed.options, 'project'), branch: flag(parsed.options, 'branch') }
      return withClient(io, parsed.options, pretty, (client) => dbQuery(client, sql, target, pretty))
    }

    case 'project': {
      if (wantsHelp) return help(projectHelp())
      if (sub === undefined) {
        return fail(EXIT.USAGE, 'usage', 'project needs a subcommand. Try: walnut project ls.', pretty)
      }
      if (sub !== 'ls') {
        return fail(EXIT.USAGE, 'usage', `Unknown project subcommand: ${sub}. Only "ls" is supported.`, pretty)
      }
      return withClient(io, parsed.options, pretty, (client) => projectLs(client, pretty))
    }

    case 'scope': {
      if (wantsHelp) return help(scopeHelp())
      if (sub === undefined) {
        return fail(EXIT.USAGE, 'usage', 'scope needs a subcommand: "ls" or "request".', pretty)
      }
      if (sub === 'ls') {
        return withClient(io, parsed.options, pretty, (client) => scopeLs(client, pretty))
      }
      if (sub === 'request') {
        if (rest.length === 0) {
          return fail(EXIT.USAGE, 'usage', 'scope request needs at least one scope (e.g. db:read db:write).', pretty)
        }
        const reason = flag(parsed.options, 'reason')
        const projectId = flag(parsed.options, 'project')
        const ttlRaw = flag(parsed.options, 'ttl')
        let expiresInSeconds: number | undefined
        if (ttlRaw !== undefined) {
          const parsedTtl = parseDuration(ttlRaw)
          if (parsedTtl === null) {
            return fail(EXIT.USAGE, 'usage', `Invalid --ttl "${ttlRaw}". Use e.g. 90s, 30m, 1h, 7d, or a number of seconds.`, pretty)
          }
          expiresInSeconds = parsedTtl
        }
        return withClient(io, parsed.options, pretty, (client) =>
          scopeRequest(client, rest, reason, projectId, expiresInSeconds, pretty),
        )
      }
      return fail(EXIT.USAGE, 'usage', `Unknown scope subcommand: ${sub}. Try "ls" or "request".`, pretty)
    }

    case 'login': {
      if (wantsHelp) return help(authHelp())
      const apiKey = typeof parsed.options['api-key'] === 'string' ? parsed.options['api-key'] : undefined
      if (apiKey === undefined) {
        return fail(EXIT.USAGE, 'usage', 'walnut login needs --api-key <key>.', pretty)
      }
      const apiUrl = typeof parsed.options['api-url'] === 'string' ? parsed.options['api-url'] : undefined
      return login(io.homeDir, apiKey, apiUrl, pretty)
    }

    case 'logout':
      if (wantsHelp) return help(authHelp())
      return logout(io.homeDir, pretty)

    default:
      return fail(EXIT.USAGE, 'unknown_command', `Unknown command: ${command}.`, pretty, {
        hint: 'Run `walnut --help` to see commands.',
      })
  }
}
