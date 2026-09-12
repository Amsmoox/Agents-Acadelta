# agentco

Control plane for running a company of AI agents. Local development scaffold —
no product features yet.

## Requirements

- Node 24+ (`nvm use`)
- pnpm 9.15+
- Docker (Postgres + MinIO)

## First run

```bash
cp .env.example .env
pnpm install
pnpm infra:up        # postgres on :5433, minio on :9000 (console :9001)
pnpm dev             # api :4100, web :5173, runner (idle loop)
```

Health check: `curl http://localhost:4100/health`

> **Docker note:** the daemon must be running first (`colima start` on this
> machine). If `docker compose` reports an unknown command, the standalone
> `docker-compose up -d` binary works too.

> **Port note:** the API listens on **4100**, not 3100 — 3100 was already taken
> by another local service.

## Layout

```
apps/
  api/        Fastify — REST + SSE + (later) MCP server. Never spawns a process.
  runner/     Dispatcher + subprocess supervisor. Never serves an HTTP request.
  web/        Vite + React + TanStack Router SPA.
packages/
  shared/     Zod schemas and types shared across api / runner / web.
  db/         Drizzle schema, client, migrations.
  adapters/   Agent adapters (claude-code, codex, acp, ...). Empty for now.
  sandbox/    SandboxProvider implementations (local-docker, ...). Empty for now.
```

**The one rule:** `api` never spawns a child process, `runner` never serves a
request. They talk only through Postgres.

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | api + runner + web in parallel |
| `pnpm build` | build every workspace |
| `pnpm typecheck` | tsc across the monorepo |
| `pnpm lint` / `pnpm format` | eslint / prettier |
| `pnpm test` | vitest |
| `pnpm db:generate` | drizzle-kit: SQL from schema |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:studio` | drizzle studio |
| `pnpm infra:up` / `infra:down` / `infra:reset` | docker compose |

See `STACK-RECOMMENDATION.md` for why each piece was chosen.

## License

MIT — Copyright © 2026 **Mharrech Ayoub** \<mharrech.ayoub@gmail.com\>

See [`LICENSE`](./LICENSE), [`NOTICE.md`](./NOTICE.md) and
[`AUTHORS.md`](./AUTHORS.md). Every source file carries an SPDX header; the
`pnpm license:check` gate fails the build if one is missing.

The MIT terms are permissive but conditional: the copyright and permission
notice must be retained in all copies and substantial portions. Forks are
welcome — keep the notices, add your own copyright line for your changes.

A running instance reports its own lineage at `GET /health/provenance`. It
makes no outbound request to anyone.
