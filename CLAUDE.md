# Community-Governed Bluesky Feed Generator

## What This Is
A Bluesky custom feed where **subscribers democratically vote on algorithm parameters**. Polis-style deliberation → tunable weights → AT Protocol feed → full transparency. No one has built this before.

## Architecture (Three Layers)
```
GOVERNANCE (Polis/Voting UI) → weight vector per epoch
    ↓
SCORING PIPELINE (batch, every 5min) → ranked posts with decomposed scores
    ↓
DATA INGESTION (Jetstream→PostgreSQL) + FEED SERVING (getFeedSkeleton→Redis)
```

## Tech Stack
- Runtime: Node.js 20 LTS, TypeScript 5.x, Fastify 5.x
- Database: PostgreSQL 16+, Redis 7+
- Key deps: @atproto/api, @atproto/xrpc-server, ws, pg, ioredis, zod
- Frontend: React 18 + Vite 5

## Project Structure
See `docs/IMPLEMENTATION_SPEC.md` §4 for full tree. Key directories:
- `src/ingestion/` — Jetstream WebSocket client + event handlers
- `src/scoring/` — 5-component scoring pipeline + governance weight application
- `src/feed/` — getFeedSkeleton endpoint (Bluesky contract)
- `src/governance/` — Vote API, epoch lifecycle, aggregation
- `src/transparency/` — Score explanations, feed stats, audit log
- `src/db/` — PostgreSQL + Redis clients, migrations, named queries
- `web/` — React voting UI + transparency dashboard
- `scripts/` — publish-feed.ts, create-did-plc.ts, seed-governance.ts

## Five Scoring Components (each returns 0.0-1.0)
1. **Recency**: Exponential decay, half-life at 1/4 of scoring window
2. **Engagement**: Log-scaled (likes×1 + reposts×2 + replies×3)
3. **Bridging**: Cross-cluster appeal via follower overlap diversity
4. **Source Diversity**: Penalize single-author domination
5. **Relevance**: MVP returns 0.5 (neutral); upgrade path: embeddings

Total score = Σ(component_score × governance_weight)

## Governance Lifecycle
1. Epoch N active with weights [r, e, b, sd, rel] summing to 1.0
2. Voting period opens → subscribers cast weight preferences
3. Votes aggregated via trimmed mean (remove top/bottom 10%)
4. New epoch created with new weights → next scoring run uses them
5. Everything logged to append-only audit log

## Common Commands
```bash
npm run build          # Compile TypeScript
npm run dev            # Dev server with hot reload
npm run migrate        # Run database migrations
npm run score          # Manually trigger scoring pipeline
npm run test           # Run test suite
docker-compose up -d   # Start PostgreSQL + Redis
```

## CRITICAL NON-NEGOTIABLE RULES
**IMPORTANT: These are absolute requirements. Violating any of them will break the project.**

1. **GOLDEN RULE**: Store ALL score components (raw score, weight, weighted value) per post per epoch. NEVER store only total_score.
2. **Tag every score with epoch_id** — required to measure governance impact across epochs.
3. **Handle deletions from day one** — soft delete (deleted=TRUE), wire up delete handler before anything else.
4. **Persist Jetstream cursor** — save cursor every ~1000 events; reconnect WITH cursor to avoid gaps.
5. **NEVER call external APIs in getFeedSkeleton** — read only from Redis/PostgreSQL. Pre-compute everything. Target <50ms.
6. **Use did:plc, NOT did:web** — one-way door. did:plc survives domain changes. Generate once, never change.
7. **Weights MUST sum to 1.0** — validate at DB, API, and UI layers. Use tolerance (0.01) + normalization.
8. **Cursor must be stable across pagination** — use feed snapshots with TTL, not live query offsets.
9. **Audit log is append-only** — NEVER update or delete entries. Trust anchor for voters.
10. **Soft delete everything** — never hard delete posts/likes/follows. Preserves referential integrity.

## Implementation Phases
Follow `TASKING.md` for step-by-step work. One phase per conversation.
- Phase 1: Skeleton (hello-world feed live on Bluesky)
- Phase 2: Ingestion (Jetstream → PostgreSQL)
- Phase 3: Scoring (governance-weighted rankings)
- Phase 4: Governance (voting UI, epoch transitions)
- Phase 5: Transparency (explainability dashboard)
- Phase 6: Hardening (error handling, load testing)

## Full Specification
The complete 2,500-line implementation spec with database schemas, working code patterns, and detailed API contracts is in `docs/IMPLEMENTATION_SPEC.md`. Read the relevant section before implementing each layer.

## Key References
- Fork from: github.com/bluesky-social/feed-generator
- Architecture model: github.com/Skygest/PaperSkygest
- Jetstream docs: github.com/bluesky-social/jetstream
- AT Protocol feeds: docs.bsky.app/docs/starter-templates/custom-feeds
