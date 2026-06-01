# 🌰 Walnut Cloud

An **agent-native cloud** — cloud primitives designed for AI agents instead of human
developers. This MVP gives each project a Postgres database that agents access through
**scoped permissions** with a human approval loop on the dashboard.

> Agents start with **no scopes**. They try an action, get a clear error telling them
> exactly what they're missing, and can request it. You approve or deny from the dashboard.

## Quick start

```bash
bun install
docker compose up -d          # Postgres on :3002
cp .env.example .env          # then set NEON_API_KEY if using the real Neon provider
bun run db:migrate
bun run dev                   # dashboard on :3000, API on :3001
```

Open http://localhost:3000 → create a project → add an agent → open its **Console**,
run `select 1`, watch it get denied, click **Request Read**, approve it under
**Notifications**, re-run.

## Try the agent API directly

```bash
# create a project, then an agent (returns a one-time apiKey)
curl -s localhost:3001/api/projects -d '{"name":"demo"}' -H 'content-type: application/json'
curl -s localhost:3001/api/projects/<PROJECT_ID>/agents -d '{"name":"claude"}' -H 'content-type: application/json'

# act as the agent
curl -s localhost:3001/agent/v1/query -H "authorization: Bearer <KEY>" \
  -H 'content-type: application/json' -d '{"sql":"select 1"}'      # 403: needs db:read
curl -s localhost:3001/agent/v1/scope-requests -H "authorization: Bearer <KEY>" \
  -H 'content-type: application/json' -d '{"scopes":["db:read"]}'  # request it
```

## Development

`bun run check` runs lint + typecheck + tests. See [CLAUDE.md](./CLAUDE.md) for the full
architecture, conventions, and the roadmap (branching, time-boxed grants, more resources).
