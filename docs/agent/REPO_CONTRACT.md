# bluesky-community-feed Repo Contract

Status: active
Owner: Andrew Nordstrom
Service class: production_service
Contract version: 1
Last updated: 2026-04-05
Last verified: 2026-04-05

## Identity

- Project key: `bluesky-feed`
- Repo: `andrewnordstrom-eng/bluesky-community-feed`
- Linear: https://linear.app/andrewnord/project/bluesky-corgi-8f5a0fc7a693
- ChatPRD: [Bluesky Community Feed — Product Brief](https://app.chatprd.ai/chat/5d8a99e4-5871-4118-b3cb-77024ee37421?doc=60435cf8-353b-4548-bc95-c358cc8cfbb6)

## Stack

- Backend: TypeScript, Fastify, PostgreSQL, Redis
- Tooling: Vitest, tsx, TypeScript CLI package under `cli/`
- Frontend: React + Vite app under `web/`
- Local MCP helper: `src/mcp-local/` when present in the working tree

## Source Of Truth

- Stable repo contract: `docs/agent/REPO_CONTRACT.md`
- Operational context: `python3 ../.github/ops/flow.py agent-context --project bluesky-feed --markdown --health`
- Queue: `python3 ../.github/ops/flow.py queue --project bluesky-feed`
- Session resume: `python3 ../.github/ops/flow.py resume bluesky-feed`

## Required Commands

- Install backend/tooling deps: `npm install`
- Install frontend deps: `npm --prefix web install`
- Lint: `npm run lint`
- Format write: `npm run format`
- Format check: `npm run format:check`
- Build backend: `npm run build`
- Test backend: `npm test -- --run`
- Build CLI: `npm run cli:build`
- Build frontend: `npm --prefix web run build`
- Full local verification: `npm run verify`

## Repo Layout

- `src/`: backend services, feed generator, governance, transparency, bot, admin, MCP
- `tests/`: Vitest coverage for backend, ingestion, governance, transparency, and stress flows
- `cli/`: TypeScript CLI for operational workflows
- `web/`: React/Vite dashboard and governance UI
- `docs/`: deployment, runbooks, stability, security, status, and system docs
- `scripts/`: migrations, DID/feed publishing, docs verification, reporting, seeding, route/component generators

## CI And Policy

- Required policy lanes: `internal-tooling-hygiene`, `linear-policy`, `quality-gate`, `security-gate`
- Repo-local CI lane: `ci.yml`
- CodeRabbit freshness and thread checks are intentionally inlined locally because this public repo cannot call reusable workflows from the private `.github` repo

## Notes For Agents

- Prefer root lint/format commands; the `web/` package delegates to the root ESLint config.
- Treat `docs/docs-site/` and screenshots as generated or binary-adjacent assets; avoid broad formatting churn there unless the task specifically targets them.
- The working tree may contain local-only artifacts such as `src/mcp-local/`; confirm whether they are part of the intended scope before editing.
