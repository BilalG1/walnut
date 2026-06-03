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
  core/  scopes, SQL scope-classifier, db provider (neon/local), roles, runSql — pure-ish, no app deps
  db/    Drizzle schema + client + migrations (drizzle/)
```

## Ports — one `PORT_PREFIX` knob (default `30`)

Every local port — and the connection strings that embed one — derives from a single
two-digit `PORT_PREFIX`. Default `30` → Frontend **3000** · API **3001** · Postgres
**3002** (container 5432). Service offsets: web `00` · api `01` · postgres `02`.

The derivation lives in `packages/core/src/ports.ts` (`portFor`, `localPostgresUrl`,
…) and is the **single source of truth** — `apps/api/src/env.ts`, `apps/web/vite.config.ts`,
drizzle/migrate/reset, the test `harness.ts`, and `docker-compose.yml` all read it.
**If you add a new port or connection string, derive it from here — never hardcode.**

**Spin up a second, fully-isolated stack** (its own container, volume, network, ports)
by picking a different two-digit prefix — no other edits:

```bash
export PORT_PREFIX=41                 # → web 4100 / api 4101 / postgres 4102
docker compose up -d && bun run db:migrate && bun run dev
```

Set `PORT_PREFIX` in `.env` or export it in the shell (`docker compose` auto-reads the
repo-root `.env`). Individual port-bearing vars (`PORT`, `DATABASE_URL`, `CORS_ORIGIN`,
`VITE_API_URL`, `LOCAL_PG_ADMIN_URL`) still override the derived defaults when set — but
if you set them, keep them consistent with the prefix or the single-knob promise breaks.

**Before choosing a prefix, confirm you won't collide with another stack.** Each prefix
owns a `41xx`-style port block plus a `walnut-<prefix>` compose project /
`walnut-postgres-<prefix>` container / `walnut-pgdata-<prefix>` volume. Reusing a prefix
another running copy already holds fails on the host-port bind or duplicate container
name. Check first:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep walnut   # which prefixes are taken
lsof -iTCP:4100-4102 -sTCP:LISTEN                            # are the target ports free
```

Two digits only (`11`–`99`); a bad prefix throws at startup (`normalizePortPrefix`).

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

## Conventions (follow these)

- **Lint + typecheck + tests must all pass after every change.** Run `bun run check`.
  oxlint runs with `--deny-warnings`; tsgo is strict (`noUncheckedIndexedAccess`,
  `noUnusedLocals/Parameters`, etc.). No `any` (allowed only in `*.test.*`).
- **Imports use explicit `.ts`/`.tsx` extensions** (bundler resolution, verbatim modules).
- **Testing:** `bun test`.
  - Unit-test complex pure functions/components (see `packages/core/test`, `apps/web/test`).
  - **Every API route has an e2e test** in `apps/api/test/api.e2e.test.ts`, driven through
    the Eden treaty client against an in-memory app + a real `walnut_test` Postgres DB
    (the `local` provider creates throwaway per-project databases).
  - Frontend component tests use `@testing-library/react` + happy-dom (preloaded via
    `apps/web/bunfig.toml`).
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
