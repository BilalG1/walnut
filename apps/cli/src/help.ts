import { VERSION } from './version.ts'

/**
 * `--help` is the discovery surface for this CLI — an agent reads it to learn the
 * whole contract (commands, the env it needs, and what the exit codes mean).
 */
export function topLevelHelp(): string {
  return `walnut ${VERSION} — agent CLI for Walnut Cloud (JSON in, JSON out)

USAGE
  walnut <command> [args] [flags]

COMMANDS
  whoami                       Print this agent's identity, scopes, and project.
  db query <sql | ->           Run SQL against the project database ("-" reads stdin).
  scope ls                     List granted scopes and pending scope requests.
  scope request <scope...>     Ask the user to grant scopes (--reason to explain).

GLOBAL FLAGS
  --api-url <url>     API base URL      (env WALNUT_API_URL, default http://localhost:3001)
  --api-key <key>     Agent API key     (env WALNUT_API_KEY)
  --pretty            Pretty-print JSON output (default: compact).
  -h, --help          Show help.
  --version           Show version.

CONFIG
  Set WALNUT_API_KEY and WALNUT_API_URL in the environment; flags override them.

EXIT CODES
  0 ok   1 unexpected   2 usage   3 auth   4 insufficient-scope   5 rejected   7 network
  Errors are printed to stderr as JSON: { "error": "...", "message": "...", ... }.`
}

export function dbHelp(): string {
  return `walnut db — database commands

USAGE
  walnut db query <sql | ->     Execute SQL (needs db:* scopes). "-" reads SQL from stdin.

EXAMPLES
  walnut db query "select 1"
  echo "select * from notes" | walnut db query -`
}

export function scopeHelp(): string {
  return `walnut scope — scope commands

USAGE
  walnut scope ls                       Granted scopes + pending requests.
  walnut scope request <scope...>       Request scopes (e.g. db:read db:write).
                                        --reason "<text>" to explain why.

EXAMPLES
  walnut scope ls
  walnut scope request db:read db:write --reason "seed the database"`
}
