/**
 * A tiny, predictable argv parser. Hand-rolled (rather than `util.parseArgs`) so we
 * can emit precise, machine-readable errors for an agent and treat a lone `-` as a
 * positional (the stdin sentinel for `db query`).
 */

/** Flags that take a value (`--flag value` or `--flag=value`). */
const VALUE_FLAGS = new Set(['api-url', 'api-key', 'reason', 'project', 'branch', 'from', 'ttl'])
/** Boolean flags (presence = true). */
const BOOL_FLAGS = new Set(['pretty', 'help', 'version'])

export interface ParsedArgs {
  positionals: string[]
  options: Record<string, string | boolean>
  error?: string
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const options: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string
    if (tok === '-h') {
      options.help = true
      continue
    }
    if (tok === '--') {
      // Everything after `--` is a positional (e.g. SQL that starts with a dash).
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=')
      const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq)
      if (BOOL_FLAGS.has(name)) {
        if (eq !== -1) {
          return { positionals, options, error: `Flag --${name} does not take a value.` }
        }
        options[name] = true
        continue
      }
      if (VALUE_FLAGS.has(name)) {
        if (eq !== -1) {
          options[name] = tok.slice(eq + 1)
          continue
        }
        const next = argv[i + 1]
        if (next === undefined) {
          return { positionals, options, error: `Flag --${name} needs a value.` }
        }
        options[name] = next
        i++
        continue
      }
      return { positionals, options, error: `Unknown flag: --${name}` }
    }
    // A lone "-" is a positional (stdin). Anything else starting with "-" is a bad flag.
    if (tok.length > 1 && tok.startsWith('-')) {
      return { positionals, options, error: `Unknown flag: ${tok}` }
    }
    positionals.push(tok)
  }

  return { positionals, options }
}
