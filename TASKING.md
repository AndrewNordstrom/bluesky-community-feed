# TASKING.md — Implementation Task Breakdown

> **For AI coding agents**: Work through these phases IN ORDER. Start a NEW CONVERSATION for each phase. Before starting any phase, read the matching section of `docs/IMPLEMENTATION_SPEC.md`. Do not skip ahead.

## How to Use This File

Each phase below is a self-contained task. When starting a phase:
1. Read the **Goal** — this is the single thing you're trying to achieve
2. Read the **Spec Sections** — open `docs/IMPLEMENTATION_SPEC.md` and read those sections
3. Work through the **Tasks** in order, checking each box
4. Run the **Verification** steps to confirm the phase works
5. Do NOT start the next phase until verification passes

---

## Phase 1: Skeleton (Days 1-2)

**Goal**: A hello-world feed that is live and visible in the Bluesky app.

**Spec Sections**: §2 (Architecture), §3 (Tech Stack), §4 (Project Structure), §5 (Environment Variables), §9.3-9.5 (describeFeedGenerator, well-known DID), §12 (Identity), §16 (Deployment)

**Tasks**:
- [ ] Initialize TypeScript project: `npm init`, tsconfig.json (strict mode), package.json with all dependencies from §3
- [ ] Create `docker-compose.yml` with PostgreSQL 16 + Redis 7
- [ ] Create `.env.example` with all variables from §5
- [ ] Create `src/config.ts` — load and validate all env vars with Zod (see Appendix A in spec)
- [ ] Create `src/db/client.ts` — PostgreSQL connection pool
- [ ] Create `src/db/redis.ts` — Redis connection
- [ ] Run migration `001_initial_schema.sql` (see §6)
- [ ] Create `src/feed/server.ts` — Fastify server
- [ ] Implement `GET /xrpc/app.bsky.feed.describeFeedGenerator` (see §9.4)
- [ ] Implement `GET /.well-known/did.json` (see §9.5)
- [ ] Implement basic `GET /xrpc/app.bsky.feed.getFeedSkeleton` that returns 3 hardcoded post URIs
- [ ] Create `src/index.ts` — entry point that starts server (see Appendix B)
- [ ] Create `scripts/create-did-plc.ts` (see §12)
- [ ] Create `scripts/publish-feed.ts` (see §16.4)

**Verification**:
```bash
docker-compose up -d
npm run build   # Zero TypeScript errors
npm run dev     # Server starts on configured port
curl http://localhost:3000/xrpc/app.bsky.feed.describeFeedGenerator  # Returns valid JSON
curl http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://...  # Returns post URIs
```
After deploying to a VPS with HTTPS and running publish-feed.ts, the feed should appear in the Bluesky app.

---

## Phase 2: Ingestion (Days 3-4)

**Goal**: Live posts flowing from Jetstream into PostgreSQL in real-time.

**Spec Sections**: §7 (Data Ingestion — all subsections), §6.1 (Initial Schema)

**Tasks**:
- [ ] Create `src/ingestion/jetstream.types.ts` — TypeScript types for Jetstream events
- [ ] Create `src/ingestion/jetstream.ts` — WebSocket client with:
  - Connection to primary Jetstream instance with collection filters
  - Cursor persistence every ~1000 events
  - Reconnection with cursor on disconnect
  - Exponential backoff (1s → 2s → 4s → ... → 60s max)
  - Fallback to secondary instance after 5 failures
- [ ] Create `src/ingestion/event-processor.ts` — parse events, route to typed handlers
- [ ] Create `src/ingestion/handlers/delete-handler.ts` — **BUILD THIS FIRST**. Soft delete (set deleted=TRUE on matching records)
- [ ] Create `src/ingestion/handlers/post-handler.ts` — insert post to `posts` table (UPSERT)
- [ ] Create `src/ingestion/handlers/like-handler.ts` — increment like counter in `post_engagements`
- [ ] Create `src/ingestion/handlers/repost-handler.ts` — increment repost counter
- [ ] Create `src/ingestion/handlers/follow-handler.ts` — insert to `social_graph`
- [ ] Wire Jetstream client into `src/index.ts` startup
- [ ] Create `src/db/queries/posts.ts` — named queries for post operations

**Verification**:
```bash
npm run dev  # Start server + Jetstream consumer
# Wait 30 seconds
psql -c "SELECT COUNT(*) FROM posts"  # Should be > 0 and growing
psql -c "SELECT COUNT(*) FROM post_engagements WHERE likes > 0"  # Should have some
psql -c "SELECT * FROM jetstream_cursor"  # Should have a recent cursor value
# Kill and restart the server — it should reconnect with cursor, no gap
```

---

## Phase 3: Scoring Pipeline (Days 5-7)

**Goal**: Posts ranked by governance-weighted scores, feed serves real ranked results.

**Spec Sections**: §6.2 (Scoring Tables), §6.3 (Governance Tables), §6.4 (Seed Data), §8 (Scoring Pipeline — all), §9 (Feed Serving — all)

**Tasks**:
- [ ] Run migrations `002_scoring_tables.sql` and `003_governance_tables.sql`
- [ ] Run seed data script to create first governance epoch with default weights
- [ ] Create `src/scoring/components/recency.ts` — exponential decay
- [ ] Create `src/scoring/components/engagement.ts` — log-scaled engagement
- [ ] Create `src/scoring/components/bridging.ts` — Jaccard distance of engager follow sets (MVP: simplified version)
- [ ] Create `src/scoring/components/source-diversity.ts` — author concentration penalty
- [ ] Create `src/scoring/components/relevance.ts` — returns 0.5 (neutral placeholder)
- [ ] Create `src/scoring/score.types.ts` — ScoreDecomposition type with all fields
- [ ] Create `src/scoring/aggregator.ts` — apply governance weights, compute total
- [ ] Create `src/scoring/pipeline.ts` — orchestrator: query posts → score → store → write to Redis
- [ ] Create `src/scoring/scheduler.ts` — cron schedule (every 5 minutes)
- [ ] Update `src/feed/routes/feed-skeleton.ts` to read from Redis sorted set
- [ ] Create `src/feed/cursor.ts` — snapshot-based cursor encode/decode
- [ ] Create `src/feed/auth.ts` — extract requester DID from JWT (optional, fire-and-forget subscriber tracking)
- [ ] Create `src/db/queries/scores.ts` — named queries for score operations
- [ ] Create `scripts/seed-governance.ts` — initialize first epoch

**Verification**:
```bash
npm run dev  # Jetstream consuming + scoring pipeline running
# Wait for first scoring run (5 minutes)
psql -c "SELECT COUNT(*) FROM post_scores"  # Should be > 0
psql -c "SELECT post_uri, recency_score, engagement_score, bridging_score, total_score FROM post_scores ORDER BY total_score DESC LIMIT 5"  # All component columns populated
redis-cli ZREVRANGE feed:current 0 4 WITHSCORES  # Top 5 posts in Redis
curl http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://...&limit=10  # Returns real ranked posts
# Verify pagination: request page 1, save cursor, request page 2 — no duplicates
```

---

## Phase 4: Governance (Days 8-10)

**Goal**: Subscribers can vote on algorithm weights, votes change the feed.

**Spec Sections**: §10 (Governance — all), §12.3 (Governance Auth)

**Tasks**:
- [ ] Create `src/governance/governance.types.ts` — vote, epoch, audit log types
- [ ] Create `src/governance/routes/vote.ts` — `POST /api/governance/vote`
  - Validate: voter is subscriber, weights sum to 1.0, one vote per voter per epoch
  - Upsert vote, log to audit trail
- [ ] Create `src/governance/routes/weights.ts` — `GET /api/governance/weights` (current + history)
- [ ] Create `src/governance/routes/epochs.ts` — `GET /api/governance/epochs`
- [ ] Create `src/governance/aggregation.ts` — trimmed mean: sort, remove 10% outliers, mean, normalize
- [ ] Create `src/governance/epoch-manager.ts` — transaction-wrapped epoch transition:
  - Close current epoch → aggregate votes → create new epoch → audit log → trigger re-score
- [ ] Implement subscriber tracking in feed-skeleton.ts (upsert on each feed request)
- [ ] Create `src/governance/routes/polis.ts` — placeholder for Polis integration
- [ ] Create `src/db/queries/governance.ts` — named queries
- [ ] Build `web/src/pages/Vote.tsx` — weight sliders UI with sum constraint
- [ ] Build `web/src/components/WeightSliders.tsx` — 5 linked sliders
- [ ] Implement governance auth (DID-based: prove handle ownership via Bluesky API)

**Verification**:
```bash
# Submit a test vote
curl -X POST http://localhost:3000/api/governance/vote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"recency":0.30,"engagement":0.10,"bridging":0.30,"source_diversity":0.15,"relevance":0.15}'
# Check vote was recorded
psql -c "SELECT * FROM governance_votes ORDER BY voted_at DESC LIMIT 1"
# Check audit log
psql -c "SELECT * FROM governance_audit_log ORDER BY created_at DESC LIMIT 5"
# Trigger epoch transition (requires >= GOVERNANCE_MIN_VOTES)
# Verify new epoch has different weights
psql -c "SELECT * FROM governance_epochs ORDER BY id DESC LIMIT 2"
# Verify next scoring run uses new weights
```

---

## Phase 5: Transparency (Days 11-12)

**Goal**: Anyone can see exactly why any post is ranked where it is.

**Spec Sections**: §11 (Transparency — all), §6.4 (Transparency Tables)

**Tasks**:
- [ ] Run migration `004_transparency_tables.sql`
- [ ] Create `src/transparency/routes/post-explain.ts` — `GET /api/transparency/post/:uri`
- [ ] Create `src/transparency/routes/feed-stats.ts` — `GET /api/transparency/stats`
- [ ] Create `src/transparency/routes/counterfactual.ts` — `GET /api/transparency/counterfactual`
- [ ] Create `src/transparency/routes/audit-log.ts` — `GET /api/transparency/audit` (paginated)
- [ ] Create `src/transparency/metrics.ts` — Gini coefficient, Jaccard similarity, distribution calculations
- [ ] Build `web/src/pages/Dashboard.tsx` — feed-level transparency stats
- [ ] Build `web/src/pages/PostExplain.tsx` — per-post score radar chart
- [ ] Build `web/src/components/ScoreRadar.tsx` — recharts radar visualization
- [ ] Build `web/src/pages/History.tsx` — epoch timeline with weight changes
- [ ] Build `web/src/components/EpochTimeline.tsx` — visual timeline

**Verification**:
```bash
# Pick a post URI from the feed
curl http://localhost:3000/api/transparency/post/at://did:plc:xxx/app.bsky.feed.post/yyy
# Should return: all 5 scores, weights, rank, counterfactual rank
curl http://localhost:3000/api/transparency/stats
# Should return: current weights, Gini coefficient, vote count, epoch info
curl http://localhost:3000/api/transparency/audit?limit=20
# Should return: ordered list of governance events
```

---

## Phase 6: Hardening (Days 13-14)

**Goal**: System runs 24 hours without intervention. Ready for real users.

**Spec Sections**: §13 (Error Handling), §14 (Rate Limits), §15 (Testing), §16 (Deployment)

**Tasks**:
- [ ] Review all error handling: every try/catch logs context (not just error.message)
- [ ] Jetstream reconnection stress test: kill connection 10 times, verify no data gaps
- [ ] Load test getFeedSkeleton: 100 concurrent requests, p95 < 50ms
- [ ] Run EXPLAIN ANALYZE on every database query, add indexes where needed
- [ ] Add structured logging with correlation IDs (request ID through full pipeline)
- [ ] Create health endpoint: `GET /health` returning DB + Redis + Jetstream status
- [ ] Set up basic uptime monitoring (external HTTP check on /health)
- [ ] Write unit tests for all scoring components
- [ ] Write integration tests for feed-skeleton and governance vote flow
- [ ] Graceful shutdown: SIGTERM → close Jetstream → flush cursor → close DB/Redis
- [ ] Review all env vars have sensible defaults
- [ ] Create production Dockerfile (multi-stage build)
- [ ] Create production docker-compose.prod.yml with nginx + SSL

**Verification**:
```bash
npm run test  # All tests pass
npm run build  # Zero errors
# Start in production mode
docker-compose -f docker-compose.prod.yml up -d
# Monitor for 24 hours:
# - Posts still flowing in
# - Scoring runs every 5 minutes
# - Feed responds < 50ms
# - No uncaught exceptions in logs
# - Jetstream recovers from disconnects
```

---

## Notes for AI Agents

1. **One phase per conversation**. Long conversations cause context drift. Start fresh for each phase.
2. **Read the spec section first**. The full implementation spec has working code patterns — use them.
3. **Don't invent new patterns**. The spec defines the database schema, API contracts, and code structure. Follow them exactly.
4. **Test as you go**. Don't write all handlers then test — write one, verify it works, then the next.
5. **If something is ambiguous, ask**. Don't guess about API contracts or database schemas.
6. **The 10 critical rules in CLAUDE.md/AGENTS.md are non-negotiable**. Re-read them before each phase.
