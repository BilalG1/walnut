# Walnut Cloud

An **agent-native cloud** — like AWS/Cloudflare but built for AI agents, not human
developers. The MVP offers one primitive: a Postgres database per **branch** (a project
is a container of branches), exposed to agents through **scoped access** with a human
approval loop. It's designed to grow (serverless functions, storage, logs, email, …)
without reshaping the core model.

## Stack

- **Runtime/tooling:** Bun (everything — install, run, test). Bun workspaces.
- **Frontend** (`apps/web`): Vite + React 19 + Tailwind v4 (`@tailwindcss/vite`).
- **Backend** (`apps/api`): Elysia + Eden treaty (type-safe RPC end to end).
- **DB:** Postgres + Drizzle ORM. Platform metadata DB via docker-compose.
- **Per-branch DBs:** each branch is its own database, provisioned via a `DatabaseProvider`
  — `neon` (a Neon project containing copy-on-write branches) or `local` (a database per
  branch on the docker Postgres, branches cloned via `CREATE DATABASE … TEMPLATE`; used by
  tests and offline dev).
- **Lint:** oxlint (strict). **Typecheck:** tsgo (`@typescript/native-preview`).

## Layout

```
apps/
  api/   Elysia app. routes/ (dashboard + agent-facing), services/, serializers, app.ts
  web/   React dashboard. components/, hooks.ts, lib/, api.ts (Eden client)
  cli/   Agent CLI (`walnut`) over the agent-facing API: whoami, project/branch ls, db query, scope
packages/
  core/      scopes, SQL scope-classifier, db provider (neon/local), roles, runSql — pure-ish, no app deps
  db/        Drizzle schema + client + migrations (drizzle/)
  ui/        shared React component library (consumed by apps/web)
  icons/     shared icon components
  db-viewer/ React component library that renders a branch DB's schema + data
```

## Ports — one `PORT_PREFIX` knob (default `30`)

Every local port — and the connection strings that embed one — derives from a single
two-digit `PORT_PREFIX`. Default `30` → Frontend **3000** · API **3001** · Postgres
**3002** (container 5432). Service offsets: web `00` · api `01` · postgres `02`.

The derivation lives in `packages/core/src/ports.ts` (`portFor`, `localPostgresUrl`,
…) and is the **single source of truth** — `apps/api/src/env.ts`, `apps/web/vite.config.ts`,
drizzle/migrate/reset, the test `harness.ts`, and `docker-compose.yml` all read it.
**If you add a new port or connection string, derive it from here — never hardcode.**

**Spin up a second, fully-isolated stack** (own container, volume, network, ports) by
picking a different two-digit prefix — no other edits: `export PORT_PREFIX=41 && docker
compose up -d && bun run db:migrate && bun run dev`. Set it in `.env` or the shell
(`docker compose` auto-reads the repo-root `.env`). Each prefix owns a `41xx` port block
plus `walnut-<prefix>` compose project / container / volume, so reusing a running prefix
fails on the port bind or duplicate container — check `docker ps | grep walnut` and
`lsof -iTCP:4100-4102 -sTCP:LISTEN` first. Two digits only (`11`–`99`;
`normalizePortPrefix` throws otherwise). Individual port-bearing vars (`PORT`,
`DATABASE_URL`, `CORS_ORIGIN`, `VITE_API_URL`, `LOCAL_PG_ADMIN_URL`) override the derived
defaults — keep them consistent with the prefix or the single-knob promise breaks.

## Commands

```bash
bun install
docker compose up -d                 # Postgres on <prefix>02 (3002 by default)
bun run db:migrate                   # apply migrations (DATABASE_URL, or the PORT_PREFIX default)
bun run dev                          # web + api together
bun run check                        # lint + typecheck + test (run before every commit)
bun run lint | typecheck | test      # individually
bun run db:generate                  # regenerate SQL migrations after schema changes
```

`.env` holds `PORT_PREFIX` (see Ports above), `NEON_API_KEY`, `DB_PROVIDER`
(`local`|`neon`), and optional overrides `DATABASE_URL` / `LOCAL_PG_ADMIN_URL`
(derived from `PORT_PREFIX` when unset). See `.env.example`.

**Release/CI:** `.github/workflows/release.yml` cross-compiles the `walnut` CLI binary on
`v*` tags via `scripts/build-release.sh` and publishes to GitHub Releases (`scripts/install.sh`
is the installer). All three surfaces have optional Sentry error reporting (off unless configured).

## Conventions (follow these)

- **Lint + typecheck + tests must all pass after every change.** Run `bun run check`.
  oxlint runs with `--deny-warnings`; tsgo is strict (`noUncheckedIndexedAccess`,
  `noUnusedLocals/Parameters`, etc.). No `any` (allowed only in `*.test.*`).
- **Imports use explicit `.ts`/`.tsx` extensions** (bundler resolution, verbatim modules).
- **Testing:** `bun test`.
  - Unit-test complex pure functions/components (see `packages/core/test`, `apps/web/test`).
  - **Every API route has an e2e test** in `apps/api/test/*.e2e.test.ts` (split by domain:
    `projects-branches`, `agents`, `scopes`, `auth-orgs`, `limits`), driven through the Eden
    treaty client against an in-memory app + a real `walnut_test` Postgres DB (the `local`
    provider creates throwaway per-project databases). Shared helpers and the per-file harness
    lifecycle (`useHarness()`) live in `apps/api/test/support.ts`.
  - Frontend component tests use `@testing-library/react` + happy-dom (preloaded via
    `apps/web/bunfig.toml`).
  - **Running a single package/file:** web tests need the package cwd — run them via
    `bun run --filter @walnut/web test` (NOT `bun test apps/web/`, which skips the
    happy-dom preload and fails). The api/cli suites share one `walnut_test` Postgres, so a
    parallel `bun run check` can occasionally flake in teardown — re-running the affected
    suite in isolation self-heals it.
- **User auth (Hexclave):** dashboard `/api/*` requests carry a Hexclave-issued JWT,
  verified offline via JWKS in `apps/api/src/auth` (`jose`; iss/aud/exp/ES256). Users
  reach projects through **organization membership** — `organizations` /
  `organization_members`, with a personal org JIT-provisioned on first login; scope all
  dashboard data by org membership, never a bare `userId`. `SYSTEM_USER_ID` lives on only
  as the seeded dev/test identity. Local sign-in without OAuth: `AUTH_DEV_BYPASS` +
  `POST /dev/auth/login` (dev-only, fails closed in prod). Frontend: `apps/web/src/auth`
  (Google/GitHub PKCE + dev-login). Projects get a `main` **branch** on creation; each branch
  has its own provisioned database and scoped roles, and is the unit agents are granted/run against.
  - **To sign in for local testing / browser automation, just use the dev-login.** Don't
    build a fake/throwaway auth server or stub the verifier — the real backend already
    gives you a one-click sign-in. The running web app shows a small **"dev login" form
    pinned top-left** (`DevLoginCorner` in `apps/web/src/auth/SignIn.tsx`, shown whenever
    `import.meta.env.DEV`): type any email, submit, and you're instantly signed in with a
    **genuine Hexclave session** (it POSTs `/dev/auth/login`, which mints real tokens). For
    headless seeding, hit `POST <api>/dev/auth/login {email}` directly to get a real
    `accessToken` and drive the API as that user (get-or-create by email, so reusing the
    same email reuses the user). Requires the env from the repo-root `.env`
    (`AUTH_DEV_BYPASS=1`, `HEXCLAVE_PROJECT_ID`, `HEXCLAVE_SECRET_SERVER_KEY`,
    `VITE_HEXCLAVE_PROJECT_ID`) — **a git worktree has no `.env` of its own, so copy the
    main checkout's `.env` into the worktree root** before `bun run dev`.
- **Nothing is shipped — break things freely.** No users and no production data, so
  migrations, backwards compatibility, and deprecation shims are wasted effort. Reshape
  schemas, rename things, and change contracts directly; regenerate migrations from the
  current schema rather than preserving history. Just keep `bun run check` green.
- **Never commit directly to `main` by default.** If you're working in a worktree, commit
  to that worktree's branch. Otherwise, create a new branch off `main` and commit there.
  Only commit straight to `main` when I explicitly tell you to. Don't open PRs unless I ask.

## Reviewing your own work before committing

- **For larger / more complex changes, self-review before you commit.** Launch several
  subagents in parallel to review the diff — typically one for correctness bugs and one for
  code-quality / simplification / reuse — then triage what they report: fix the issues that
  are real and valid, and ignore false positives. The goal is to catch problems early, before
  they land in a commit. **For small, low-risk fixes this is overkill — skip it** and just run
  `bun run check`.
- **For large UI changes, record a walkthrough for quick human review.** Use the `agent-browser`
  CLI (`agent-browser --help`) to drive the dashboard through the affected flows end to end and
  record the full walkthrough into `/tmp`. When done, give me the full file path to the recording
  so I can eyeball the result quickly. (Sign in with the dev-login — see User auth above.)

## The agent model (the point of the project)

- **Agents** belong to an **organization** (`agents.organization_id`), created at the org level
  (`POST /api/organizations/:orgId/agents`) and **born with zero grants** — they request access to
  any project (or branch) in the org. They authenticate to the agent-facing API with a bearer key
  (`/agent/v1/*`); only a SHA-256 hash is stored. The agent CLI (`apps/cli`) targets a project with
  `--project` and a branch with `--branch` (defaulting to the agent's sole project and that
  project's `main` branch; erroring `ambiguous_project` if several) and discovers ids/names via
  `walnut project ls` / `walnut branch ls`.
- **Scopes** are strings, currently DB-only: `db:read`, `db:write`, `db:delete`, `db:ddl`
  (defined in `packages/core/src/scopes.ts`). The union type is deliberately open so future
  domains (`fn:deploy`, `email:send`, `logs:read`) drop in without a schema change. A grant is
  anchored to a **resource** — `org`, `project`, or `branch` (`GrantResourceType`) — and
  `SCOPES_BY_RESOURCE` gates which scopes are grantable where: `db:*` at project or branch — a
  project grant **cascades to every branch**, a branch grant covers just that branch — never at the
  `org` level, which is reserved vocabulary for future org-wide non-database scopes. An agent's
  effective scopes on a branch are the expiry-filtered union over that grant chain.
- **Enforcement is two layers (defense in depth):**
  1. **Engine boundary (primary):** enforcement is keyed by **scope set, not by agent**. Each branch
     database has four `NOLOGIN` group roles (`_read/_write/_delete/_ddl`) plus, provisioned lazily
     on first use, up to 2⁴ shared `LOGIN` **scope roles** — each a member of exactly the group roles
     for one scope subset, cached in `branch_db_roles` keyed by `(branch, scopeKey)`. A query computes
     the agent's effective scopes for the target branch and runs over that branch's matching scope-role
     connection — never the owner connection — so the database itself refuses anything ungranted. Role
     lifecycle lives in `packages/core/src/roles.ts` (`ensureScopeRole`); a grant carries no Postgres
     role, so approval/denial/expiry are pure metadata and a scope change just selects a different
     (lesser/greater) connection — there's no per-agent role to reconcile.
  2. **Classifier (first guard + UX):** `POST /agent/v1/query` runs `classifySql`
     (`packages/core/src/sql.ts`), which parses with the **real PostgreSQL grammar**
     (`pgsql-parser`/libpg_query) and maps each statement's AST to the scope(s) it needs. Missing
     a scope → **403 with a clear, machine-readable body** telling the agent what it lacks and how
     to request it. This drives the approval loop; it can now fail open without being a breach
     because the engine enforces — but it still **fails safe** (unknown/unparsed statement →
     `db:ddl`) so it never under-reports.
- **Approval loop:** an agent calls `POST /agent/v1/scope-requests` (targeting a resource — by raw
  `resourceType`/`resourceId`, or the agent-friendly `projectId`/`branch` *name*, or defaulting to
  its sole project); the request appears as a dashboard notification; the user approves/denies
  (`/api/scope-requests/:id/approve|deny`). Approval merges the scopes into the agent's grant for
  that resource — a **pure metadata write** (no Postgres role touched; the engine picks the matching
  shared scope-role connection on the agent's next query).
- **The classifier** is multi-statement and writable-CTE aware and handles the nasty cases —
  `EXPLAIN ANALYZE` (which *executes*), `SELECT … INTO` (a CTAS), `SET ROLE`, `COPY … FROM PROGRAM`,
  `MERGE`, comments, string/dollar-quote literals — by working from the AST, not a token scan.
  **If you add SQL features, add classifier tests for them** (`packages/core/test/sql.test.ts`).
  Known remaining gaps are covered by the engine, not the classifier: side-effecting functions in
  read position (e.g. a write-performing UDF in a `SELECT`) classify as `db:read` but are refused
  by the role. `db:ddl` ownership of agent-created objects is the rough edge (schema-level `CREATE`
  + per-scope-role default privileges; objects are owned by the shared scope role that created
  them, so ddl agents on a branch are mutually trusted; no superuser-only event triggers, so it
  works on Neon).

## Built on this model — and where it extends

- **Branching (built):** each branch is its own database — a Neon copy-on-write branch, or a local
  `CREATE DATABASE … TEMPLATE` clone. Identity (`providerBranchId`/`connectionUri`/`status`) lives
  on `branches`; a project keeps only its container id. Branch CRUD is `POST/DELETE
  /api/projects/:id/branches[/:branch]`; the default branch can't be deleted. The `DatabaseProvider`
  (`provisionProject`/`createBranch`/`destroyBranch`/`destroyProject`) is the extension point — keep
  it provider-agnostic (local is "flat", Neon is a "container").
- **Time-boxed grants (built):** `scope_requests.expiresInSeconds` → a per-scope deadline on
  `agent_grant_scopes`; an expired scope simply drops from the effective set (no revoke step).
  Single-command/one-shot grants would extend `scope_requests` further.
- **More resources:** the open scope string + the resource tree (`org`→`project`→`branch`→…) +
  provider abstractions remain the extension points for future domains (`fn:deploy`, storage, …).

## Limits & rate limits

The platform runs on **one shared Neon account**, so unbounded use by one tenant isn't just a
bill — it can exhaust account-wide quotas (projects, branches/compute endpoints, the Neon API
rate limit) shared by everyone. Every limit is defined in **one place** —
`packages/core/src/limits.ts` (the single source of truth, like `ports.ts`) — and applied in
three layers:

- **Resource caps (`RESOURCE_LIMITS`)** — durable count ceilings checked with a `COUNT` *before*
  any provider call (projects/org, branches/project, branches/org, agents/org, pending
  scope-requests/agent), enforced in the create services. Over the limit → **403 `limit_exceeded`**
  with `{ limit, max, scope }`. Count-then-insert is best-effort (no transaction), bounded by
  concurrency. The org is the anchor — today one org == one user (JIT personal orgs).
- **Per-request caps (`QUERY_LIMITS`)** — in the query path: SQL payload > 100 KB → **413
  `sql_too_large`** before parsing; `runSql` truncates result sets to 10 k rows / 8 MB and flags
  `truncated` (a default-LIMIT, not an error); a per-statement `statement_timeout` bounds DB-side
  work on both the scope roles and the viewer's owner connection.
- **Rate limits (`RATE_LIMITS`) + concurrency** — an in-memory token-bucket limiter
  (`createRateLimiter`, `packages/core/src/rate-limit.ts`; `enforceRate` in
  `apps/api/src/rate-limit.ts`) covering per-agent query rate, provisioning, scope-requests,
  key-rotation, plus a per-branch concurrent-query gauge. Over budget → **429 `rate_limited`** with
  `retryAfterMs` + `Retry-After`. Process-local (lost on restart, resource caps are the durable
  backstop); swap in a shared store (Redis) behind the same interface to span instances. Tests inject
  a frozen-clock limiter and `reset()` per case. (`authPerIp` is reserved — no login endpoint yet.)
