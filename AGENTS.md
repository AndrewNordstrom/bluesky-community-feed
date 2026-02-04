# Community-Governed Bluesky Feed Generator

> **For AI coding agents**: This project builds a Bluesky custom feed where subscribers democratically vote on algorithm parameters. Read `TASKING.md` for phased implementation tasks. Read `docs/IMPLEMENTATION_SPEC.md` for the full technical specification with database schemas and working code patterns.

## Architecture
```
GOVERNANCE (Polis/Voting UI) → weight vector per epoch
    ↓
SCORING PIPELINE (batch, every 5min) → ranked posts with decomposed scores
    ↓
DATA INGESTION (Jetstream→PostgreSQL) + FEED SERVING (getFeedSkeleton→Redis)
```

## Tech Stack
Node.js 20 LTS, TypeScript 5.x, Fastify 5.x, PostgreSQL 16+, Redis 7+, React 18 + Vite 5.
Key deps: @atproto/api, @atproto/xrpc-server, ws, pg, ioredis, zod.

## Project Layout
- `src/ingestion/` — Jetstream WebSocket + event handlers
- `src/scoring/` — 5-component scoring pipeline + governance weights
- `src/feed/` — getFeedSkeleton (Bluesky API contract)
- `src/governance/` — Voting API, epoch lifecycle, trimmed-mean aggregation
- `src/transparency/` — Score explanations, feed stats, audit log
- `src/db/` — PostgreSQL + Redis, migrations, named queries
- `web/` — React voting UI + transparency dashboard

## Scoring Formula
Five components (each 0.0-1.0): recency, engagement, bridging, source_diversity, relevance.
`total_score = Σ(component_score × governance_weight)` where weights sum to 1.0.

## CRITICAL RULES — DO NOT VIOLATE
1. Store ALL score components per post per epoch (raw, weight, weighted). NEVER just total_score.
2. Tag every score with governance epoch_id.
3. Handle deletions from day one (soft delete, deleted=TRUE flag).
4. Persist Jetstream cursor every ~1000 events. Reconnect WITH cursor.
5. NEVER call external APIs in getFeedSkeleton. Redis/PostgreSQL only. Target <50ms.
6. Use did:plc, NOT did:web. One-way door decision.
7. Weights MUST sum to 1.0. Validate at DB, API, and UI layers.
8. Feed pagination cursor must use snapshots with TTL for stability.
9. Audit log is append-only. NEVER update or delete.
10. Soft delete everything. Never hard delete posts/likes/follows.

## Verification Commands
```bash
npm run build          # Must pass with zero errors
npm run test           # Must pass before committing
npm run migrate        # Run all database migrations
docker-compose up -d   # PostgreSQL + Redis
```

## Implementation Order
Follow `TASKING.md`. One phase at a time. Read the matching section of `docs/IMPLEMENTATION_SPEC.md` before starting each phase.
