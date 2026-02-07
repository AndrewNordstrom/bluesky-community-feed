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

---

## ⚠️ CURRENT TASK: Admin Dashboard

**READ THIS SPEC FIRST:** `docs/ADMIN_DASHBOARD_SPEC.md`

This is an 8-phase implementation plan for a protected admin interface. Follow these rules strictly:

### How to Work Through the Spec

1. **Work phase by phase** — Complete Phase 1 fully before starting Phase 2
2. **Run ALL tests in each phase** — Every phase has a "Phase N Testing" section with curl commands and verification steps. Run them ALL and confirm they pass.
3. **Don't proceed until tests pass** — If a phase's tests fail, fix the issues before moving on
4. **Check existing code first** — Some modules already exist (audit, bot, session, logger, db). Import and integrate with them rather than duplicating
5. **Match Vote page styling exactly** — Reference `web/src/pages/Vote.tsx` and existing CSS files. The admin UI must look like it belongs

### Critical Implementation Rules

1. **Auth is non-negotiable** — Every admin endpoint MUST use `requireAdmin` hook. Test with a non-admin user to verify 403.
2. **Log everything to audit_log** — All admin actions must be logged. Verify in audit_log table after each action.
3. **Handle edge cases** — Empty states, loading states, error states for all components
4. **Type safety** — Use TypeScript strictly. Define interfaces for all API responses.
5. **Mobile responsive** — Test all components at mobile widths
6. **No orphan code** — Every new file must be imported/registered somewhere

### Phase Checkpoints

After each phase, verify:
- [ ] All new files compile without errors (`npm run build`)
- [ ] All tests in the "Phase N Testing" section pass
- [ ] No regressions in existing functionality (feed still works, voting still works)
- [ ] Audit log captures new actions (where applicable)

### Design Tokens (MUST match Vote page)
```css
--bg-primary: #161718
--bg-card: #1e1f21
--accent-blue: #1083fe
--text-primary: #f1f3f5
--text-secondary: #787c7e
--border: #2a2b2d
--success: #10b981
--error: #ef4444
--warning: #f59e0b
```

### Existing Modules to Reuse

Before creating new modules, check these existing files:
- `src/db/index.ts` — getDb() for PostgreSQL
- `src/db/redis.ts` — getRedis() for Redis  
- `src/logger.ts` — logger instance
- `src/auth/session.ts` — getSession() for user auth
- `src/governance/audit.ts` — logAuditEvent() for audit logging
- `src/bot/announcements.ts` — existing announcement functions
- `src/governance/epoch-manager.ts` — closeCurrentEpochAndCreateNext()
- `src/governance/content-filter.ts` — getCurrentContentRules()

### Starting the Implementation

Begin with this prompt:
```
Read docs/ADMIN_DASHBOARD_SPEC.md completely. Then implement Phase 1 (Database & Auth Foundation). After implementation, run all Phase 1 tests from the spec and report results. Do not start Phase 2 until I confirm Phase 1 is working.
```

After each phase passes tests, say:
```
Phase N tests pass. Proceed with Phase N+1.
```

---

## Key References
- Fork from: github.com/bluesky-social/feed-generator
- Architecture model: github.com/Skygest/PaperSkygest
- Jetstream docs: github.com/bluesky-social/jetstream
- AT Protocol feeds: docs.bsky.app/docs/starter-templates/custom-feeds
