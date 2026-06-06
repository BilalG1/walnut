<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/walnut-logo-dark.svg">
    <img src="assets/walnut-logo-light.svg" alt="Walnut Cloud" width="96" height="96">
  </picture>
</p>

# Walnut Cloud

**An agent-first alternative to Supabase.** Walnut gives your AI agents real cloud
infrastructure — a Postgres database and object storage per branch — but behind **agent
identities**, **fine-grained scopes**, and a **human approval loop**, so an agent only ever
gets the access you approve.

### → [Try it at **app.walnut.sh**](https://app.walnut.sh)

Create a project, mint an agent key, and grant access in a couple of clicks. No setup.

## Why Walnut

Supabase and friends are built for human developers clicking around a dashboard. Walnut is
built for **agents acting on your behalf** — with the guardrails that implies:

- **Agent identities.** Every agent is a first-class principal with its own API key, born
  with **zero access**. No shared service-role key that can do anything.
- **Fine-grained scopes + human approval.** Access is granted as narrow scopes
  (`db:read`, `db:write`, `db:ddl`, `storage:*`) anchored to a specific project or branch.
  An agent *requests* what it needs; you approve or deny from the dashboard. It's enforced
  twice — a SQL classifier (real Postgres grammar) **and** the database engine itself
  (per-scope Postgres roles) — so an agent physically can't exceed what you granted.
- **Instant branching — database _and_ storage.** Fork a full copy-on-write branch (its own
  Postgres DB + object store) in seconds, so an agent can experiment on an isolated copy and
  you can throw it away. O(1) regardless of how much data it holds.

## How it works

1. Create a **project** at [app.walnut.sh](https://app.walnut.sh) — it comes with a `main`
   branch backed by a dedicated Postgres database and object store.
2. Add an **agent** and hand it the API key.
3. Your agent calls the API (or the `walnut` CLI) and hits a clear, machine-readable `403`
   telling it exactly which scope it lacks. It requests access, you approve, it continues.

```bash
# install the agent CLI
curl -fsSL https://walnut.sh/install | bash

walnut login --api-key <key>
walnut db query "select 1"     # 403 → needs db:read
walnut scope request db:read   # asks you to approve in the dashboard
```

## Self-hosting

Walnut is open source and runs locally with **no external accounts**: Postgres branches via
Docker, object storage via MinIO, and a built-in passwordless auth that signs you in
automatically. Neon and Hexclave are optional upgrades, not requirements.

```bash
bun install
docker compose up -d     # Postgres + MinIO
cp .env.example .env      # works as-is — local DB provider + built-in local auth
bun run db:migrate
bun run dev               # dashboard :3000 · API :3001
```

Open http://localhost:3000 — you're signed in automatically, no account needed. To use the
managed backends instead, set `NEON_API_KEY` + `DB_PROVIDER=neon` for Neon-backed branches,
or `HEXCLAVE_PROJECT_ID` for Google/GitHub OAuth. See [CLAUDE.md](./CLAUDE.md) for the full
architecture, configuration, and conventions; `bun run check` runs lint + typecheck + tests.

## License

[MIT](./LICENSE)
