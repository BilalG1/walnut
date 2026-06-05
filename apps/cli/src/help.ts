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
  whoami                       Print this agent's identity, scopes, org, and home project.
  project ls                   List the projects in this agent's organization (id + name).
  branch ls                    List a project's branches (id + name + default).
  branch create <name>         Fork a new branch (--from <branch>; needs branch:create).
  db query <sql | ->           Run SQL against a branch database ("-" reads stdin).
  storage ls [prefix]          List stored objects under a prefix (needs storage:read).
  storage cp <src> <dst>       Upload/download via walnut://<path> (needs storage:read/write).
  storage cat <path>           Print an object's bytes to stdout (needs storage:read).
  storage rm <path>            Delete an object on the branch (needs storage:delete).
  storage stat <path>          Show one object's metadata (needs storage:read).
  scope ls                     List granted scopes and pending scope requests.
  scope request <scope...>     Ask the user to grant scopes (--reason to explain).

TARGETING (db query, storage, branch ls, scope request)
  An agent is org-scoped and may reach several projects. Commands take an optional
  --project; omit it and the server uses the one project you can reach (and errors,
  listing candidates, if there are several). Use \`walnut project ls\` to find ids and
  \`walnut branch ls\` to find branch names. db query and scope request also take an
  optional --branch <name> (default: the project's main branch).

GLOBAL FLAGS
  --api-url <url>     API base URL (overrides the stored value; default https://api.walnut.sh).
  --api-key <key>     Agent API key (overrides the stored value, for one-off calls).
  --project <id>      Target project (default: the agent's sole project).
  --branch <name>     Target branch for db query / scope request (default: main).
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

export function projectHelp(): string {
  return `walnut project — project commands

USAGE
  walnut project ls     List the projects in this agent's organization (id + name).

NOTES
  Lists every project in the org, including ones the agent has no access to yet — use
  the ids with \`--project\` on db query, or to request access with \`scope request\`.`
}

export function branchHelp(): string {
  return `walnut branch — branch commands

USAGE
  walnut branch ls                    List a project's branches (id + name + default).
  walnut branch create <name>         Fork a new branch from an existing one.

FLAGS
  --project <id>     Target project (default: the agent's sole project; required if it
                     can reach several — the error lists the candidates).
  --from <branch>    Source branch to fork from (branch create only; default: main).

NOTES
  Each branch is its own database. Use a branch name with \`db query --branch <name>\`
  to run there, or \`scope request --branch <name>\` to request access to just that branch.

  \`branch create\` needs the \`branch:create\` scope (grantable on the org, the project, or
  the source branch); a 403 lists how to request it. The fork is a copy-on-write clone of
  --from, with its own database — request db scopes on it (or on the project, which cascade)
  to query it.

EXAMPLES
  walnut branch create feature-x
  walnut branch create feature-x --from main
  walnut branch create hotfix --project <id> --from release`
}

export function dbHelp(): string {
  return `walnut db — database commands

USAGE
  walnut db query <sql | ->     Execute SQL (needs db:* scopes). "-" reads SQL from stdin.

FLAGS
  --project <id>     Target project (default: the agent's sole project; required if it
                     can reach several — the error lists the candidates).
  --branch <name>    Target branch (default: main).

EXAMPLES
  walnut db query "select 1"
  walnut db query --project <id> "select 1"
  echo "select * from notes" | walnut db query -`
}

export function storageHelp(): string {
  return `walnut storage — per-branch object storage

USAGE
  walnut storage ls [prefix]              List the branch's objects under a prefix (needs storage:read).
  walnut storage cp <local> walnut://<p>  Upload a local file (needs storage:write).
  walnut storage cp walnut://<p> <local>  Download to a local file (needs storage:read).
  walnut storage cat <path>               Print an object's bytes to stdout (needs storage:read).
  walnut storage rm <path>                Delete an object on the branch (needs storage:delete).
  walnut storage stat <path>              Show one object's metadata (needs storage:read).

FLAGS
  --project <id>     Target project (default: the agent's sole project; required if it
                     can reach several — the error lists the candidates).
  --branch <name>    Target branch (default: main).

NOTES
  Storage branches with the database: a forked branch instantly inherits its parent's objects
  (an overwrite or delete on the branch shadows the inherited one, leaving the parent untouched).
  Bytes stream directly to/from the object store via short-lived presigned URLs — never through
  the API. \`cat\` is text-oriented; use \`cp\` for binary files. A 403 lists how to request scopes.

EXAMPLES
  walnut storage cp ./model.bin walnut://models/v1.bin
  walnut storage ls models/
  walnut storage cat config.json --branch feature-x
  walnut storage cp walnut://models/v1.bin ./local.bin
  walnut storage rm old/file.txt`
}

export function scopeHelp(): string {
  return `walnut scope — scope commands

USAGE
  walnut scope ls                       Granted scopes + pending requests.
  walnut scope request <scope...>       Request scopes (e.g. db:read db:write).
                                        --reason "<text>" to explain why.
                                        --project <id> to target a specific project.
                                        --branch <name> to request access to just that branch.
                                        --ttl <dur> to time-box once approved
                                        (90s, 30m, 1h, 7d, or seconds; default permanent).

EXAMPLES
  walnut scope ls
  walnut scope request db:read db:write --reason "seed the database"
  walnut scope request db:write --ttl 1h --reason "one-off migration"
  walnut scope request db:read --project <id>
  walnut scope request db:write --branch feature-x --reason "migrate on the feature branch"`
}
