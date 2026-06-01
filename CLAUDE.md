# Walnut Cloud

An **agent-native cloud** — like AWS/Cloudflare but built for AI agents, not human
developers. The MVP offers one primitive: a Postgres database per project, exposed
to agents through **scoped access** with a human approval loop. It's designed to grow
(serverless functions, storage, logs, email, …) without reshaping the core model.

## Stack

- **Runtime/tooling:** Bun (everything — install, run, test). Bun workspaces.
- **Frontend** (`apps/web`): Vite + React 19 + Tailwind v4 (`@tailwindcss/vite`).
- **Backend** (`apps/api`): Elysia + Eden treaty (type-safe RPC end to end).
- **DB:** Postgres + Drizzle ORM. Platform metadata DB via docker-compose.
- **Per-project DBs:** provisioned via a `DatabaseProvider` — `neon` (real Neon API)
  or `local` (a database on the docker Postgres; used by tests and offline dev).
- **Lint:** oxlint (strict). **Typecheck:** tsgo (`@typescript/native-preview`).

## Layout

```
apps/
  api/   Elysia app. routes/ (dashboard + agent-facing), services/, serializers, app.ts
  web/   React dashboard. components/, hooks.ts, lib/, api.ts (Eden client)
packages/
  core/  scopes, SQL scope-classifier, db provider (neon/local), runSql — pure-ish, no app deps
  db/    Drizzle schema + client + migrations (drizzle/)
```

## Ports (everything on 3xxx)

- Frontend: **3000** · API: **3001** · Postgres: **3002** (container 5432)

## Commands

```bash
bun install
docker compose up -d                 # Postgres on 3002
bun run db:migrate                   # apply migrations (needs DATABASE_URL)
bun run dev                          # web + api together
bun run check                        # lint + typecheck + test (run before every commit)
bun run lint | typecheck | test      # individually
bun run db:generate                  # regenerate SQL migrations after schema changes
```

`.env` holds `NEON_API_KEY`, `DATABASE_URL`, `DB_PROVIDER` (`local`|`neon`),
`LOCAL_PG_ADMIN_URL`. See `.env.example`.

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
- **No auth yet:** owner is hard-coded `SYSTEM_USER_ID` (`00000000-…`). Keep all data
  scoped by `userId` so real auth slots in later.
- **Nothing is shipped — break things freely.** No users and no production data, so
  migrations, backwards compatibility, and deprecation shims are wasted effort. Reshape
  schemas, rename things, and change contracts directly; regenerate migrations from the
  current schema rather than preserving history. Just keep `bun run check` green.
- **Commit to `main` locally by default.** Make small local commits straight on `main`;
  don't open PRs or create feature branches unless I explicitly ask for one.

## The agent model (the point of the project)

- **Agents** belong to a project and start with **zero scopes**. They authenticate to the
  agent-facing API with a bearer key (`/agent/v1/*`); only a SHA-256 hash is stored.
- **Scopes** are strings, currently DB-only: `db:read`, `db:write`, `db:delete`, `db:ddl`
  (defined in `packages/core/src/scopes.ts`). The union type is deliberately open so future
  domains (`fn:deploy`, `email:send`, `logs:read`) drop in without a schema change.
- **Enforcement is two layers (defense in depth):**
  1. **Engine boundary (primary):** each agent gets its own restricted Postgres **login role**,
     a member of four per-project `NOLOGIN` group roles (`_read/_write/_delete/_ddl`). Agent
     queries run over the **agent's scoped connection** (`agents.connection_uri`), never the
     project owner connection, so the database itself refuses anything ungranted. Role lifecycle
     lives in `packages/core/src/roles.ts`; approval/denial = `GRANT`/`REVOKE` group membership.
  2. **Classifier (first guard + UX):** `POST /agent/v1/query` runs `classifySql`
     (`packages/core/src/sql.ts`), which parses with the **real PostgreSQL grammar**
     (`pgsql-parser`/libpg_query) and maps each statement's AST to the scope(s) it needs. Missing
     a scope → **403 with a clear, machine-readable body** telling the agent what it lacks and how
     to request it. This drives the approval loop; it can now fail open without being a breach
     because the engine enforces — but it still **fails safe** (unknown/unparsed statement →
     `db:ddl`) so it never under-reports.
- **Approval loop:** an agent calls `POST /agent/v1/scope-requests`; the request appears as a
  dashboard notification; the user approves/denies (`/api/scope-requests/:id/approve|deny`).
  Approval merges the scopes into the agent **and** syncs its Postgres role memberships.
- **The classifier** is multi-statement and writable-CTE aware and handles the nasty cases —
  `EXPLAIN ANALYZE` (which *executes*), `SELECT … INTO` (a CTAS), `SET ROLE`, `COPY … FROM PROGRAM`,
  `MERGE`, comments, string/dollar-quote literals — by working from the AST, not a token scan.
  **If you add SQL features, add classifier tests for them** (`packages/core/test/sql.test.ts`).
  Known remaining gaps are covered by the engine, not the classifier: side-effecting functions in
  read position (e.g. a write-performing UDF in a `SELECT`) classify as `db:read` but are refused
  by the role. `db:ddl` ownership of agent-created objects is the rough edge (schema-level `CREATE`
  + per-agent default privileges; no superuser-only event triggers, so it works on Neon).

## Designed-for (not built yet) — keep these in mind

- **Branching:** Neon supports instant DB branching; future work branches a whole project
  (config + optional data) and scopes agents to specific branches. Don't bake "one DB per
  project forever" assumptions into the provider interface.
- **Time-boxed / one-shot grants:** scope requests may later be 1h/1d or single-command.
  `scope_requests` is the natural place to extend.
- **More resources:** the scope string + provider abstractions are the extension points.
