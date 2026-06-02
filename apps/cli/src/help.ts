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
  login --api-key <key>        Store credentials (the user runs this once).
  logout                       Remove stored credentials.
  whoami                       Print this agent's identity, scopes, and project.
  db query <sql | ->           Run SQL against the project database ("-" reads stdin).
  scope ls                     List granted scopes and pending scope requests.
  scope request <scope...>     Ask the user to grant scopes (--reason to explain).

GLOBAL FLAGS
  --api-url <url>     API base URL (overrides the stored value; default https://api.walnut.sh).
  --api-key <key>     Agent API key (overrides the stored value, for one-off calls).
  --pretty            Pretty-print JSON output (default: compact).
  -h, --help          Show help.
  --version           Show version.

CONFIG
  Credentials live in ~/.walnut/credentials.json. Authenticate by having the user run
  \`walnut login --api-key <key> [--api-url <url>]\` once; flags override the stored values.

EXIT CODES
  0 ok   1 unexpected   2 usage   3 auth   4 insufficient-scope   5 rejected   7 network
  Errors are printed to stderr as JSON: { "error": "...", "message": "...", ... }.`
}

export function authHelp(): string {
  return `walnut login / logout — manage stored credentials

USAGE
  walnut login --api-key <key> [--api-url <url>]   Store credentials in ~/.walnut/credentials.json
  walnut logout                                    Remove stored credentials

NOTES
  The user creates the agent in the dashboard, which shows the key once; they pass it
  here. Credentials are written owner-only (chmod 600). Run \`walnut whoami\` to verify.`
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
