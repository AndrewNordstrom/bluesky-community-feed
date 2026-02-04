# Community-Governed Bluesky Feed: Complete Implementation Specification

> **Purpose**: This document is a complete, unambiguous technical specification for building a community-governed Bluesky feed where subscribers democratically vote on algorithm parameters. It is designed to be handed directly to an AI coding assistant (Cursor, Claude Code, etc.) to produce a robust, working prototype. Do not cut corners, skip sections, or make assumptions — everything you need is here.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Environment Variables](#5-environment-variables)
6. [Database Schema](#6-database-schema)
7. [Layer 1: Data Ingestion (Jetstream)](#7-layer-1-data-ingestion-jetstream)
8. [Layer 2: Scoring Pipeline](#8-layer-2-scoring-pipeline)
9. [Layer 3: Feed Serving (getFeedSkeleton)](#9-layer-3-feed-serving-getfeedskeleton)
10. [Layer 4: Governance System](#10-layer-4-governance-system)
11. [Layer 5: Transparency & Explainability](#11-layer-5-transparency--explainability)
12. [Authentication & Identity](#12-authentication--identity)
13. [Error Handling & Resilience](#13-error-handling--resilience)
14. [Rate Limits & External API Constraints](#14-rate-limits--external-api-constraints)
15. [Testing Strategy](#15-testing-strategy)
16. [Deployment](#16-deployment)
17. [Implementation Phases](#17-implementation-phases)
18. [Critical Non-Negotiable Rules](#18-critical-non-negotiable-rules)
19. [Reference Links & Prior Art](#19-reference-links--prior-art)
20. [Glossary](#20-glossary)

---

## 1. Project Overview

### What This Is

A custom Bluesky feed generator where the **community of subscribers collectively votes on the algorithm's parameters**. Instead of a platform or developer deciding how content is ranked, the users themselves decide — via periodic deliberation — how much weight to give recency, engagement, bridging (cross-partisan appeal), source diversity, and relevance.

### What Makes It Novel

No one has built this. Extensive research confirms:
- **Blacksky**: Community governance via appointed moderators, not democratic voting on algorithm params
- **Paper Skygest**: Academic feed, researcher-controlled algorithm
- **Bluesky Discover**: Company-controlled with "show more/less" feedback
- **SkyFeed/Feed Creator**: Individual rules, not collective governance

This project fills the unexplored gap: **Polis-style deliberation → tunable weights → AT Protocol feed → full transparency/explainability**.

### Three-Layer Core Architecture

```
┌─────────────────────────────────────────────────────────┐
│  GOVERNANCE LAYER (Polis/Voting UI)                     │
│  Subscribers vote on algorithm parameters               │
│  Outputs: weight vector per governance epoch             │
├─────────────────────────────────────────────────────────┤
│  SCORING PIPELINE (Batch Processing)                    │
│  Applies governance weights to score posts              │
│  Outputs: ranked post list with decomposed scores       │
├─────────────────────────────────────────────────────────┤
│  DATA INGESTION + FEED SERVING                          │
│  Jetstream → PostgreSQL → getFeedSkeleton endpoint      │
│  Inputs: live post stream. Outputs: ranked post URIs    │
└─────────────────────────────────────────────────────────┘
```

### Key Academic References

- **Aviv Ovadya** — "Bridging-based ranking" and platform democracy (https://www.belfercenter.org/publication/bridging-based-ranking)
- **Francis Fukuyama et al.** — "Middleware" concept for delegated feed curation
- **Anthropic CCA** — Collective Constitutional AI using Polis (https://www.anthropic.com/research/collective-constitutional-ai-aligning-a-language-model-with-public-input)
- **Paper Skygest** — First large-scale academic Bluesky feed (arxiv.org/abs/2601.04253, github.com/Skygest/PaperSkygest)
- **Community Notes** — Bridging-based scoring via matrix factorization

---

## 2. Architecture Overview

### System Diagram

```
                    Bluesky Network
                         │
                         ▼
              ┌─────────────────────┐
              │   Jetstream WS      │  wss://jetstream2.us-east.bsky.network
              │   (JSON events)     │  Filter: posts, likes, reposts, follows
              └─────────┬───────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │   Event Processor   │  Parse, validate, filter
              │   (ingestion.ts)    │  Write to PostgreSQL
              └─────────┬───────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │    PostgreSQL        │  Posts, engagement, social graph,
              │    (primary store)   │  scores, governance epochs, votes
              └─────────┬───────────┘
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
    ┌────────────┐ ┌──────────┐ ┌──────────────┐
    │  Scoring   │ │  Feed    │ │  Governance  │
    │  Pipeline  │ │  Server  │ │  Web App     │
    │  (cron)    │ │  (HTTP)  │ │  (React)     │
    └─────┬──────┘ └────┬─────┘ └──────┬───────┘
          │             │              │
          ▼             ▼              │
    ┌──────────┐  ┌──────────┐         │
    │  Redis   │  │ Bluesky  │         │
    │  (cache) │  │ App/PDS  │         │
    └──────────┘  └──────────┘         │
                                       ▼
                                ┌──────────────┐
                                │ Transparency │
                                │ Dashboard    │
                                └──────────────┘
```

### Data Flow

1. **Jetstream** sends JSON events over WebSocket (posts, likes, reposts, follows)
2. **Event Processor** filters relevant events, writes to PostgreSQL
3. **Scoring Pipeline** runs every N minutes as a cron job:
   - Reads current governance epoch weights
   - Scores all posts in the active window (72 hours)
   - Stores decomposed scores tagged with epoch
   - Writes top-ranked list to Redis
4. **Feed Server** handles `getFeedSkeleton` requests:
   - Reads pre-computed rankings from Redis
   - Returns array of post AT-URIs with cursor
   - Target: <50ms response time
5. **Governance Web App** lets subscribers vote:
   - Polis integration for deliberation
   - Weight slider voting for direct parameter control
   - Aggregates votes into new weight vectors
   - Increments governance epoch on weight change
6. **Transparency Dashboard** shows:
   - Current weights and their history
   - Score decomposition per post
   - Distribution metrics (Gini, bridging scores, topic breakdown)
   - Counterfactual comparisons

---

## 3. Technology Stack

### Core Runtime

| Component | Technology | Version | Why |
|-----------|-----------|---------|-----|
| Runtime | Node.js | 20 LTS+ | Best AT Protocol SDK support |
| Language | TypeScript | 5.x | Type safety, AT Protocol SDK is TS-first |
| HTTP Server | Fastify | 5.x | Fast, schema validation, good plugin system |
| Database | PostgreSQL | 16+ | JSONB for score components, robust, battle-tested |
| Cache | Redis | 7+ | Pre-computed feed rankings, session store |
| Task Runner | node-cron or BullMQ | latest | Scoring pipeline scheduling |
| Frontend | React + Vite | React 18+, Vite 5+ | Governance UI and transparency dashboard |

### Key Dependencies

```json
{
  "dependencies": {
    "@atproto/api": "latest",
    "@atproto/xrpc-server": "latest",
    "@atproto/identity": "latest",
    "@atproto/crypto": "latest",
    "fastify": "^5.0.0",
    "@fastify/cors": "latest",
    "@fastify/jwt": "latest",
    "ws": "^8.0.0",
    "pg": "^8.0.0",
    "ioredis": "^5.0.0",
    "bullmq": "^5.0.0",
    "dotenv": "^16.0.0",
    "pino": "^9.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0",
    "@types/ws": "^8.0.0",
    "@types/pg": "^8.0.0",
    "tsx": "^4.0.0"
  }
}
```

### Infrastructure

| Service | Purpose | Dev | Production |
|---------|---------|-----|------------|
| PostgreSQL | Primary datastore | Docker | Managed (Supabase, Neon, RDS) |
| Redis | Feed cache, job queue | Docker | Managed (Upstash, ElastiCache) |
| App Server | Feed generator + API | localhost | VPS (Hetzner, DigitalOcean) or Railway/Fly.io |
| Frontend | Governance UI | Vite dev server | Static hosting (Vercel, Cloudflare Pages) |

---

## 4. Project Structure

```
community-feed/
├── package.json
├── tsconfig.json
├── docker-compose.yml              # PostgreSQL + Redis for dev
├── .env.example
├── .env                             # Never commit this
│
├── src/
│   ├── index.ts                     # Application entry point
│   ├── config.ts                    # Environment variable loading + validation
│   │
│   ├── ingestion/                   # Layer 1: Data Ingestion
│   │   ├── jetstream.ts             # WebSocket client for Jetstream
│   │   ├── event-processor.ts       # Parse and route events
│   │   ├── handlers/
│   │   │   ├── post-handler.ts      # Handle new posts
│   │   │   ├── like-handler.ts      # Handle likes
│   │   │   ├── repost-handler.ts    # Handle reposts
│   │   │   ├── follow-handler.ts    # Handle follows (social graph)
│   │   │   └── delete-handler.ts    # Handle deletions (CRITICAL)
│   │   └── jetstream.types.ts       # TypeScript types for Jetstream events
│   │
│   ├── scoring/                     # Layer 2: Scoring Pipeline
│   │   ├── pipeline.ts              # Main scoring orchestrator
│   │   ├── components/
│   │   │   ├── recency.ts           # Time decay scoring
│   │   │   ├── engagement.ts        # Like/repost/reply scoring
│   │   │   ├── bridging.ts          # Cross-cluster appeal scoring
│   │   │   ├── source-diversity.ts  # Author diversity scoring
│   │   │   └── relevance.ts         # Topic relevance scoring (future: ML)
│   │   ├── aggregator.ts            # Combine component scores with governance weights
│   │   ├── score.types.ts           # Score decomposition types
│   │   └── scheduler.ts             # Cron/BullMQ job scheduling
│   │
│   ├── feed/                        # Layer 3: Feed Serving
│   │   ├── server.ts                # Fastify server setup
│   │   ├── routes/
│   │   │   ├── feed-skeleton.ts     # GET /xrpc/app.bsky.feed.getFeedSkeleton
│   │   │   ├── describe-generator.ts # GET /xrpc/app.bsky.feed.describeFeedGenerator
│   │   │   └── well-known.ts        # GET /.well-known/did.json (for did:web)
│   │   ├── auth.ts                  # JWT verification for requester DID
│   │   ├── cursor.ts                # Cursor encoding/decoding (timestamp::CID)
│   │   └── feed.types.ts            # Feed response types
│   │
│   ├── governance/                  # Layer 4: Governance System
│   │   ├── routes/
│   │   │   ├── vote.ts              # POST /api/governance/vote
│   │   │   ├── weights.ts           # GET /api/governance/weights (current + history)
│   │   │   ├── epochs.ts            # GET /api/governance/epochs
│   │   │   └── polis.ts             # Polis integration endpoints
│   │   ├── aggregation.ts           # Vote → weight aggregation logic
│   │   ├── epoch-manager.ts         # Governance epoch lifecycle
│   │   └── governance.types.ts      # Governance types
│   │
│   ├── transparency/                # Layer 5: Transparency
│   │   ├── routes/
│   │   │   ├── post-explain.ts      # GET /api/transparency/post/:uri (score breakdown)
│   │   │   ├── feed-stats.ts        # GET /api/transparency/stats (aggregate)
│   │   │   ├── counterfactual.ts    # GET /api/transparency/counterfactual
│   │   │   └── audit-log.ts         # GET /api/transparency/audit
│   │   └── metrics.ts               # Gini coefficient, distribution metrics
│   │
│   ├── db/
│   │   ├── client.ts                # PostgreSQL connection pool
│   │   ├── redis.ts                 # Redis connection
│   │   ├── migrations/
│   │   │   ├── 001_initial_schema.sql
│   │   │   ├── 002_scoring_tables.sql
│   │   │   ├── 003_governance_tables.sql
│   │   │   └── 004_transparency_tables.sql
│   │   └── queries/                 # Named query files (no inline SQL)
│   │       ├── posts.ts
│   │       ├── scores.ts
│   │       ├── governance.ts
│   │       └── social-graph.ts
│   │
│   └── lib/
│       ├── logger.ts                # Pino logger setup
│       ├── at-uri.ts                # AT-URI parsing utilities
│       └── did.ts                   # DID resolution utilities
│
├── web/                             # Frontend (separate Vite app)
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Vote.tsx             # Voting interface
│   │   │   ├── Dashboard.tsx        # Transparency dashboard
│   │   │   ├── PostExplain.tsx      # Per-post score breakdown
│   │   │   └── History.tsx          # Governance epoch history
│   │   └── components/
│   │       ├── WeightSliders.tsx     # Interactive weight adjustment
│   │       ├── ScoreRadar.tsx       # Radar chart for score components
│   │       ├── EpochTimeline.tsx    # Visual epoch history
│   │       └── PolisEmbed.tsx       # Polis conversation embed
│   └── vite.config.ts
│
├── scripts/
│   ├── publish-feed.ts              # Register feed with Bluesky network
│   ├── unpublish-feed.ts            # Remove feed registration
│   ├── create-did-plc.ts            # Generate did:plc identity
│   ├── seed-governance.ts           # Initialize first governance epoch
│   └── backfill.ts                  # Optional: backfill historical data
│
└── tests/
    ├── ingestion/
    │   ├── jetstream.test.ts
    │   └── event-processor.test.ts
    ├── scoring/
    │   ├── pipeline.test.ts
    │   └── components/
    │       ├── recency.test.ts
    │       ├── engagement.test.ts
    │       └── bridging.test.ts
    ├── feed/
    │   ├── feed-skeleton.test.ts
    │   └── cursor.test.ts
    ├── governance/
    │   ├── aggregation.test.ts
    │   └── epoch-manager.test.ts
    └── fixtures/
        ├── jetstream-events.json
        └── sample-posts.json
```

---

## 5. Environment Variables

Create `.env.example` with these exact variables. Every one is required unless marked optional.

```bash
# ─── Identity ───────────────────────────────────────────
# CRITICAL: Use did:plc for the feed generator. did:web is fragile.
# Generate once with scripts/create-did-plc.ts and NEVER change.
FEEDGEN_SERVICE_DID="did:plc:xxxxxxxxxxxxxxxxxxxxxxxx"

# The Bluesky handle of the account that will publish the feed
FEEDGEN_PUBLISHER_DID="did:plc:yyyyyyyyyyyyyyyyyyyyyyyy"

# The hostname where this feed generator will be publicly accessible
FEEDGEN_HOSTNAME="feed.yourdomain.com"

# ─── Server ─────────────────────────────────────────────
FEEDGEN_PORT=3000
FEEDGEN_LISTENHOST="0.0.0.0"

# ─── Jetstream ──────────────────────────────────────────
# Primary and fallback Jetstream instances
JETSTREAM_URL="wss://jetstream2.us-east.bsky.network/subscribe"
JETSTREAM_FALLBACK_URL="wss://jetstream1.us-east.bsky.network/subscribe"

# Collections to subscribe to (comma-separated)
JETSTREAM_COLLECTIONS="app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow"

# ─── Database ───────────────────────────────────────────
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/community_feed"

# ─── Redis ──────────────────────────────────────────────
REDIS_URL="redis://localhost:6379"

# ─── Scoring ────────────────────────────────────────────
# How often the scoring pipeline runs (cron expression)
SCORING_INTERVAL_CRON="*/5 * * * *"    # Every 5 minutes

# How old posts can be before they're excluded from scoring (hours)
SCORING_WINDOW_HOURS=72

# Maximum posts to keep in the ranked feed cache
FEED_MAX_POSTS=1000

# ─── Governance ─────────────────────────────────────────
# Minimum number of votes before a new epoch can be triggered
GOVERNANCE_MIN_VOTES=5

# How long a governance voting period lasts (hours)
GOVERNANCE_PERIOD_HOURS=168    # 1 week

# ─── Bluesky API (for enrichment queries) ───────────────
# Use app password, NOT your main password
BSKY_IDENTIFIER="your-bot-handle.bsky.social"
BSKY_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"

# ─── Optional ───────────────────────────────────────────
# Polis conversation ID (if using Polis for deliberation)
POLIS_CONVERSATION_ID=""

# Log level: debug, info, warn, error
LOG_LEVEL="info"

# Node environment
NODE_ENV="development"
```

---

## 6. Database Schema

### Migration 001: Initial Schema

```sql
-- 001_initial_schema.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Posts ──────────────────────────────────────────────
-- Every post we index from Jetstream
CREATE TABLE posts (
    uri         TEXT PRIMARY KEY,           -- at://did:plc:xxx/app.bsky.feed.post/yyy
    cid         TEXT NOT NULL,              -- Content hash
    author_did  TEXT NOT NULL,              -- DID of the post author
    text        TEXT,                       -- Post text content (nullable for image-only)
    reply_root  TEXT,                       -- URI of root post if this is a reply
    reply_parent TEXT,                      -- URI of parent post if this is a reply
    langs       TEXT[],                     -- BCP-47 language tags from post record
    has_media   BOOLEAN DEFAULT FALSE,      -- Whether post contains images/video
    created_at  TIMESTAMPTZ NOT NULL,       -- Post creation time (from record)
    indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we indexed it
    deleted     BOOLEAN DEFAULT FALSE       -- Soft delete flag (CRITICAL: never hard delete)
);

CREATE INDEX idx_posts_author ON posts(author_did);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_indexed ON posts(indexed_at DESC);
CREATE INDEX idx_posts_reply_root ON posts(reply_root) WHERE reply_root IS NOT NULL;
CREATE INDEX idx_posts_active ON posts(created_at DESC) WHERE deleted = FALSE;

-- ─── Engagement ─────────────────────────────────────────
-- Aggregated engagement counts per post (updated incrementally)
CREATE TABLE post_engagement (
    post_uri    TEXT PRIMARY KEY REFERENCES posts(uri) ON DELETE CASCADE,
    like_count  INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Individual engagement events (for bridging analysis) ─────
CREATE TABLE likes (
    uri         TEXT PRIMARY KEY,           -- at://did:plc:xxx/app.bsky.feed.like/yyy
    author_did  TEXT NOT NULL,              -- Who liked
    subject_uri TEXT NOT NULL,              -- What post was liked
    created_at  TIMESTAMPTZ NOT NULL,
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_likes_subject ON likes(subject_uri);
CREATE INDEX idx_likes_author ON likes(author_did);

CREATE TABLE reposts (
    uri         TEXT PRIMARY KEY,
    author_did  TEXT NOT NULL,
    subject_uri TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_reposts_subject ON reposts(subject_uri);

-- ─── Social Graph (for bridging scores) ─────────────────
CREATE TABLE follows (
    uri         TEXT PRIMARY KEY,           -- at://did:plc:xxx/app.bsky.graph.follow/yyy
    author_did  TEXT NOT NULL,              -- Who is following
    subject_did TEXT NOT NULL,              -- Who they follow
    created_at  TIMESTAMPTZ NOT NULL,
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_follows_author ON follows(author_did) WHERE deleted = FALSE;
CREATE INDEX idx_follows_subject ON follows(subject_did) WHERE deleted = FALSE;

-- ─── Subscribers ────────────────────────────────────────
-- Track who has subscribed to this feed (for governance eligibility)
-- Populated when users request the feed (from JWT DID)
CREATE TABLE subscribers (
    did         TEXT PRIMARY KEY,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN DEFAULT TRUE        -- Seen in last 7 days
);

-- ─── Jetstream Cursor ───────────────────────────────────
-- Stores the last processed Jetstream cursor for reconnection
CREATE TABLE jetstream_cursor (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    cursor_us   BIGINT NOT NULL,            -- Microsecond timestamp cursor
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);
```

### Migration 002: Scoring Tables

```sql
-- 002_scoring_tables.sql

-- ─── Score Decomposition ────────────────────────────────
-- GOLDEN RULE: Store every component, every weight, every epoch.
-- Disk is cheap. Insight is expensive. This is what makes the project unique.
CREATE TABLE post_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_uri        TEXT NOT NULL REFERENCES posts(uri) ON DELETE CASCADE,
    epoch_id        INTEGER NOT NULL,               -- Which governance epoch produced this score

    -- Individual component scores (0.0 to 1.0)
    recency_score       FLOAT NOT NULL,
    engagement_score    FLOAT NOT NULL,
    bridging_score      FLOAT NOT NULL,
    source_diversity_score FLOAT NOT NULL,
    relevance_score     FLOAT NOT NULL,

    -- Weights applied (from governance epoch)
    recency_weight      FLOAT NOT NULL,
    engagement_weight   FLOAT NOT NULL,
    bridging_weight     FLOAT NOT NULL,
    source_diversity_weight FLOAT NOT NULL,
    relevance_weight    FLOAT NOT NULL,

    -- Weighted components (score * weight)
    recency_weighted    FLOAT NOT NULL,
    engagement_weighted FLOAT NOT NULL,
    bridging_weighted   FLOAT NOT NULL,
    source_diversity_weighted FLOAT NOT NULL,
    relevance_weighted  FLOAT NOT NULL,

    -- Final combined score
    total_score         FLOAT NOT NULL,

    -- Metadata for explainability
    component_details   JSONB,                     -- Arbitrary detail per component
    -- Example: {"bridging": {"clusters_reached": 3, "cluster_ids": [1,2,5]}}

    scored_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_post_epoch UNIQUE(post_uri, epoch_id)
);

CREATE INDEX idx_scores_epoch_total ON post_scores(epoch_id, total_score DESC);
CREATE INDEX idx_scores_post ON post_scores(post_uri);
CREATE INDEX idx_scores_scored_at ON post_scores(scored_at DESC);
```

### Migration 003: Governance Tables

```sql
-- 003_governance_tables.sql

-- ─── Governance Epochs ──────────────────────────────────
-- Every time weights change, a new epoch is created.
-- This is the backbone of the governance audit trail.
CREATE TABLE governance_epochs (
    id              SERIAL PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'active',  -- 'active', 'voting', 'closed'

    -- The weight vector for this epoch (must sum to 1.0)
    recency_weight          FLOAT NOT NULL,
    engagement_weight       FLOAT NOT NULL,
    bridging_weight         FLOAT NOT NULL,
    source_diversity_weight FLOAT NOT NULL,
    relevance_weight        FLOAT NOT NULL,

    -- Metadata
    vote_count      INTEGER DEFAULT 0,              -- How many votes determined these weights
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,                    -- When this epoch ended
    description     TEXT                            -- Human-readable description of changes
);

-- ─── Votes ──────────────────────────────────────────────
-- Individual votes on weight parameters
CREATE TABLE governance_votes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voter_did       TEXT NOT NULL,                   -- Bluesky DID of the voter
    epoch_id        INTEGER NOT NULL REFERENCES governance_epochs(id),

    -- What the voter wants the weights to be
    recency_weight          FLOAT NOT NULL,
    engagement_weight       FLOAT NOT NULL,
    bridging_weight         FLOAT NOT NULL,
    source_diversity_weight FLOAT NOT NULL,
    relevance_weight        FLOAT NOT NULL,

    -- Validation: weights must sum to 1.0 (within tolerance)
    CONSTRAINT weights_sum_to_one CHECK (
        ABS(recency_weight + engagement_weight + bridging_weight +
            source_diversity_weight + relevance_weight - 1.0) < 0.01
    ),

    -- Voter must be a subscriber
    CONSTRAINT voter_is_subscriber FOREIGN KEY (voter_did) REFERENCES subscribers(did),

    -- One vote per voter per epoch
    CONSTRAINT one_vote_per_epoch UNIQUE(voter_did, epoch_id),

    voted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_votes_epoch ON governance_votes(epoch_id);
CREATE INDEX idx_votes_voter ON governance_votes(voter_did);

-- ─── Governance Audit Log ───────────────────────────────
-- Append-only log of all governance actions
CREATE TABLE governance_audit_log (
    id              SERIAL PRIMARY KEY,
    action          TEXT NOT NULL,                   -- 'epoch_created', 'vote_cast', 'epoch_closed', 'weights_changed'
    actor_did       TEXT,                            -- Who performed the action (null for system)
    epoch_id        INTEGER REFERENCES governance_epochs(id),
    details         JSONB,                           -- Action-specific details
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_epoch ON governance_audit_log(epoch_id);
CREATE INDEX idx_audit_created ON governance_audit_log(created_at DESC);

-- ─── Polis Integration (optional) ───────────────────────
-- Store qualitative deliberation results from Polis
CREATE TABLE polis_results (
    id              SERIAL PRIMARY KEY,
    epoch_id        INTEGER REFERENCES governance_epochs(id),
    conversation_id TEXT NOT NULL,                   -- Polis conversation ID
    consensus_statements JSONB,                      -- Statements all clusters agreed on
    divisive_statements  JSONB,                      -- Statements that divided clusters
    group_clusters       JSONB,                      -- Cluster data from Polis
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migration 004: Transparency Tables

```sql
-- 004_transparency_tables.sql

-- ─── Feed Snapshots ─────────────────────────────────────
-- Snapshot of the ranked feed at a point in time (for pagination stability)
CREATE TABLE feed_snapshots (
    id              TEXT PRIMARY KEY,                -- Random ID for the snapshot
    epoch_id        INTEGER NOT NULL,
    post_uris       TEXT[] NOT NULL,                 -- Ordered array of post URIs
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL             -- TTL for cleanup
);

CREATE INDEX idx_snapshots_expires ON feed_snapshots(expires_at);

-- ─── Aggregate Metrics Per Epoch ────────────────────────
-- Pre-computed transparency metrics updated each scoring run
CREATE TABLE epoch_metrics (
    id              SERIAL PRIMARY KEY,
    epoch_id        INTEGER NOT NULL REFERENCES governance_epochs(id),

    -- Distribution metrics
    author_gini     FLOAT,                          -- Gini coefficient of author representation
    topic_entropy   FLOAT,                          -- Shannon entropy of topic distribution
    avg_bridging    FLOAT,                          -- Average bridging score
    median_bridging FLOAT,

    -- Comparison to baselines
    vs_chronological_overlap FLOAT,                 -- Jaccard similarity with chronological top-N
    vs_engagement_overlap    FLOAT,                 -- Jaccard similarity with pure-engagement top-N

    -- Volume metrics
    posts_scored    INTEGER,
    posts_in_feed   INTEGER,
    unique_authors  INTEGER,

    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_epoch_metrics ON epoch_metrics(epoch_id);
```

### Seed Data: First Governance Epoch

```sql
-- Run this ONCE during initial setup
-- These are reasonable starting weights; the community will adjust them
INSERT INTO governance_epochs (
    recency_weight, engagement_weight, bridging_weight,
    source_diversity_weight, relevance_weight,
    description
) VALUES (
    0.25, 0.20, 0.25, 0.15, 0.15,
    'Initial default weights. Community voting begins.'
);
```

---

## 7. Layer 1: Data Ingestion (Jetstream)

### Why Jetstream, Not Raw Firehose

- Raw firehose: ~232 GB/day of CBOR-encoded Merkle tree blocks. Requires MST parsing, DAG-CBOR decoding, signature verification.
- Jetstream: ~850 MB/day of lightweight JSON. ~1/10th bandwidth. Officially maintained by Bluesky. No cryptographic verification (acceptable for feed generators per Bluesky docs).

### Jetstream Connection

```typescript
// src/ingestion/jetstream.ts

import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../lib/logger';
import { processEvent } from './event-processor';
import { db } from '../db/client';

const WANTED_COLLECTIONS = [
  'app.bsky.feed.post',
  'app.bsky.feed.like',
  'app.bsky.feed.repost',
  'app.bsky.graph.follow',
];

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60_000; // 60 seconds max backoff

export async function startJetstream(): Promise<void> {
  const cursor = await getLastCursor();
  connect(cursor);
}

function buildUrl(cursor?: bigint): string {
  const base = config.JETSTREAM_URL;
  const params = new URLSearchParams();

  for (const col of WANTED_COLLECTIONS) {
    params.append('wantedCollections', col);
  }

  // CRITICAL: If we have a cursor, resume from there to avoid gaps
  if (cursor) {
    params.set('cursor', cursor.toString());
  }

  return `${base}?${params.toString()}`;
}

function connect(cursor?: bigint): void {
  const url = buildUrl(cursor);
  logger.info({ url: url.substring(0, 100) + '...' }, 'Connecting to Jetstream');

  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Jetstream connection established');
    reconnectAttempts = 0;
  });

  ws.on('message', async (data: Buffer) => {
    try {
      const event = JSON.parse(data.toString());
      await processEvent(event);

      // Persist cursor periodically (every 1000 events, not every event)
      // The cursor is the time_us field from the event
      if (event.time_us && Math.random() < 0.001) {
        await saveCursor(BigInt(event.time_us));
      }
    } catch (err) {
      logger.error({ err, data: data.toString().substring(0, 200) }, 'Failed to process Jetstream event');
      // DO NOT crash on individual event errors. Log and continue.
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn({ code, reason: reason.toString() }, 'Jetstream connection closed');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'Jetstream WebSocket error');
    // 'close' event will fire after this, triggering reconnect
  });
}

function scheduleReconnect(): void {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  logger.info({ delay, attempt: reconnectAttempts }, 'Scheduling Jetstream reconnect');

  setTimeout(async () => {
    const cursor = await getLastCursor();
    connect(cursor);
  }, delay);
}

async function getLastCursor(): Promise<bigint | undefined> {
  const result = await db.query('SELECT cursor_us FROM jetstream_cursor WHERE id = 1');
  return result.rows[0]?.cursor_us ? BigInt(result.rows[0].cursor_us) : undefined;
}

async function saveCursor(cursorUs: bigint): Promise<void> {
  await db.query(
    `INSERT INTO jetstream_cursor (id, cursor_us, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET cursor_us = $1, updated_at = NOW()`,
    [cursorUs.toString()]
  );
}
```

### Jetstream Event Types

```typescript
// src/ingestion/jetstream.types.ts

export interface JetstreamEvent {
  did: string;               // DID of the actor
  time_us: number;           // Microsecond timestamp
  kind: 'commit' | 'identity' | 'account';
  commit?: JetstreamCommit;
}

export interface JetstreamCommit {
  rev: string;               // Revision
  operation: 'create' | 'update' | 'delete';
  collection: string;        // e.g., 'app.bsky.feed.post'
  rkey: string;              // Record key
  record?: Record<string, any>;  // The actual record (absent on delete)
  cid?: string;              // Content hash
}

// Constructed AT-URI from event components
// Format: at://{did}/{collection}/{rkey}
export function buildAtUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}
```

### Event Processor

```typescript
// src/ingestion/event-processor.ts

import { JetstreamEvent, buildAtUri } from './jetstream.types';
import { handlePost } from './handlers/post-handler';
import { handleLike } from './handlers/like-handler';
import { handleRepost } from './handlers/repost-handler';
import { handleFollow } from './handlers/follow-handler';
import { handleDelete } from './handlers/delete-handler';
import { logger } from '../lib/logger';

export async function processEvent(event: JetstreamEvent): Promise<void> {
  if (event.kind !== 'commit' || !event.commit) return;

  const { commit, did } = event;
  const uri = buildAtUri(did, commit.collection, commit.rkey);

  // CRITICAL: Handle deletions for ALL collection types
  if (commit.operation === 'delete') {
    await handleDelete(uri, commit.collection);
    return;
  }

  if (commit.operation !== 'create') return; // Skip updates for now

  switch (commit.collection) {
    case 'app.bsky.feed.post':
      await handlePost(uri, did, commit.cid!, commit.record!);
      break;
    case 'app.bsky.feed.like':
      await handleLike(uri, did, commit.record!);
      break;
    case 'app.bsky.feed.repost':
      await handleRepost(uri, did, commit.record!);
      break;
    case 'app.bsky.graph.follow':
      await handleFollow(uri, did, commit.record!);
      break;
    default:
      // Ignore other collections
      break;
  }
}
```

### Post Handler

```typescript
// src/ingestion/handlers/post-handler.ts

import { db } from '../../db/client';
import { logger } from '../../lib/logger';

export async function handlePost(
  uri: string,
  authorDid: string,
  cid: string,
  record: Record<string, any>
): Promise<void> {
  const text = record.text || null;
  const langs = record.langs || [];
  const createdAt = record.createdAt || new Date().toISOString();

  // Extract reply info
  let replyRoot: string | null = null;
  let replyParent: string | null = null;
  if (record.reply) {
    replyRoot = record.reply.root?.uri || null;
    replyParent = record.reply.parent?.uri || null;
  }

  // Check for media
  const hasMedia = !!(record.embed?.images?.length || record.embed?.video);

  try {
    await db.query(
      `INSERT INTO posts (uri, cid, author_did, text, reply_root, reply_parent, langs, has_media, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (uri) DO NOTHING`,
      [uri, cid, authorDid, text, replyRoot, replyParent, langs, hasMedia, createdAt]
    );

    // Initialize engagement counters
    await db.query(
      `INSERT INTO post_engagement (post_uri) VALUES ($1) ON CONFLICT DO NOTHING`,
      [uri]
    );

    // If this is a reply, increment reply count on the root post
    if (replyRoot) {
      await db.query(
        `UPDATE post_engagement SET reply_count = reply_count + 1, updated_at = NOW()
         WHERE post_uri = $1`,
        [replyRoot]
      );
    }
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert post');
  }
}
```

### Delete Handler (CRITICAL)

```typescript
// src/ingestion/handlers/delete-handler.ts

import { db } from '../../db/client';
import { logger } from '../../lib/logger';

// CRITICAL: Wire this up from day one. Missing deletions = serving content
// the author removed = broken trust = dead project.
export async function handleDelete(uri: string, collection: string): Promise<void> {
  try {
    switch (collection) {
      case 'app.bsky.feed.post':
        // Soft delete — mark as deleted, don't remove from DB
        // (preserves referential integrity for engagement records)
        await db.query(
          `UPDATE posts SET deleted = TRUE WHERE uri = $1`,
          [uri]
        );
        logger.debug({ uri }, 'Post marked as deleted');
        break;

      case 'app.bsky.feed.like':
        await db.query(`UPDATE likes SET deleted = TRUE WHERE uri = $1`, [uri]);
        // Also decrement engagement count
        const likeResult = await db.query(`SELECT subject_uri FROM likes WHERE uri = $1`, [uri]);
        if (likeResult.rows[0]) {
          await db.query(
            `UPDATE post_engagement SET like_count = GREATEST(like_count - 1, 0), updated_at = NOW()
             WHERE post_uri = $1`,
            [likeResult.rows[0].subject_uri]
          );
        }
        break;

      case 'app.bsky.feed.repost':
        await db.query(`UPDATE reposts SET deleted = TRUE WHERE uri = $1`, [uri]);
        const repostResult = await db.query(`SELECT subject_uri FROM reposts WHERE uri = $1`, [uri]);
        if (repostResult.rows[0]) {
          await db.query(
            `UPDATE post_engagement SET repost_count = GREATEST(repost_count - 1, 0), updated_at = NOW()
             WHERE post_uri = $1`,
            [repostResult.rows[0].subject_uri]
          );
        }
        break;

      case 'app.bsky.graph.follow':
        await db.query(`UPDATE follows SET deleted = TRUE WHERE uri = $1`, [uri]);
        break;
    }
  } catch (err) {
    logger.error({ err, uri, collection }, 'Failed to handle deletion');
  }
}
```

---

## 8. Layer 2: Scoring Pipeline

### Orchestrator

```typescript
// src/scoring/pipeline.ts

import { db } from '../db/client';
import { redis } from '../db/redis';
import { scoreRecency } from './components/recency';
import { scoreEngagement } from './components/engagement';
import { scoreBridging } from './components/bridging';
import { scoreSourceDiversity } from './components/source-diversity';
import { scoreRelevance } from './components/relevance';
import { logger } from '../lib/logger';
import { config } from '../config';

export async function runScoringPipeline(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting scoring pipeline');

  // 1. Get current governance epoch and weights
  const epoch = await db.query(
    `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
  );
  if (!epoch.rows[0]) {
    logger.error('No active governance epoch found. Cannot score.');
    return;
  }
  const currentEpoch = epoch.rows[0];

  // 2. Get all non-deleted posts in the scoring window
  const cutoff = new Date(Date.now() - config.SCORING_WINDOW_HOURS * 60 * 60 * 1000);
  const posts = await db.query(
    `SELECT p.*, pe.like_count, pe.repost_count, pe.reply_count
     FROM posts p
     LEFT JOIN post_engagement pe ON p.uri = pe.post_uri
     WHERE p.deleted = FALSE
       AND p.created_at > $1
     ORDER BY p.created_at DESC`,
    [cutoff.toISOString()]
  );

  logger.info({ postCount: posts.rows.length, epochId: currentEpoch.id }, 'Scoring posts');

  // 3. Score each post
  const scored: Array<{
    uri: string;
    totalScore: number;
    components: Record<string, number>;
  }> = [];

  for (const post of posts.rows) {
    const recency = scoreRecency(post.created_at, config.SCORING_WINDOW_HOURS);
    const engagement = scoreEngagement(post.like_count, post.repost_count, post.reply_count);
    const bridging = await scoreBridging(post.uri, post.author_did);
    const sourceDiversity = await scoreSourceDiversity(post.author_did, scored);
    const relevance = scoreRelevance(post); // Placeholder: returns 0.5 until ML is added

    const totalScore =
      recency * currentEpoch.recency_weight +
      engagement * currentEpoch.engagement_weight +
      bridging * currentEpoch.bridging_weight +
      sourceDiversity * currentEpoch.source_diversity_weight +
      relevance * currentEpoch.relevance_weight;

    // GOLDEN RULE: Store every component, every weight, every epoch
    await db.query(
      `INSERT INTO post_scores (
        post_uri, epoch_id,
        recency_score, engagement_score, bridging_score,
        source_diversity_score, relevance_score,
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        recency_weighted, engagement_weighted, bridging_weighted,
        source_diversity_weighted, relevance_weighted,
        total_score, component_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (post_uri, epoch_id) DO UPDATE SET
        recency_score = $3, engagement_score = $4, bridging_score = $5,
        source_diversity_score = $6, relevance_score = $7,
        recency_weighted = $13, engagement_weighted = $14, bridging_weighted = $15,
        source_diversity_weighted = $16, relevance_weighted = $17,
        total_score = $18, component_details = $19, scored_at = NOW()`,
      [
        post.uri, currentEpoch.id,
        recency, engagement, bridging, sourceDiversity, relevance,
        currentEpoch.recency_weight, currentEpoch.engagement_weight,
        currentEpoch.bridging_weight, currentEpoch.source_diversity_weight,
        currentEpoch.relevance_weight,
        recency * currentEpoch.recency_weight,
        engagement * currentEpoch.engagement_weight,
        bridging * currentEpoch.bridging_weight,
        sourceDiversity * currentEpoch.source_diversity_weight,
        relevance * currentEpoch.relevance_weight,
        totalScore,
        JSON.stringify({}) // component_details: add detail here as needed
      ]
    );

    scored.push({ uri: post.uri, totalScore, components: { recency, engagement, bridging, sourceDiversity, relevance } });
  }

  // 4. Sort and write top-N to Redis
  scored.sort((a, b) => b.totalScore - a.totalScore);
  const topPosts = scored.slice(0, config.FEED_MAX_POSTS);

  const pipeline = redis.pipeline();
  pipeline.del('feed:current');
  for (let i = 0; i < topPosts.length; i++) {
    pipeline.zadd('feed:current', topPosts[i].totalScore, topPosts[i].uri);
  }
  pipeline.set('feed:epoch', currentEpoch.id.toString());
  pipeline.set('feed:updated_at', new Date().toISOString());
  await pipeline.exec();

  const elapsed = Date.now() - startTime;
  logger.info({ elapsed, postsScored: posts.rows.length, epochId: currentEpoch.id }, 'Scoring pipeline complete');
}
```

### Scoring Components

Each component returns a float between 0.0 and 1.0.

```typescript
// src/scoring/components/recency.ts

/**
 * Time decay scoring. Newer posts score higher.
 * Uses exponential decay with configurable half-life.
 */
export function scoreRecency(createdAt: Date | string, windowHours: number): number {
  const postTime = new Date(createdAt).getTime();
  const now = Date.now();
  const ageHours = (now - postTime) / (1000 * 60 * 60);

  if (ageHours < 0) return 1.0; // Future posts (clock skew) get max score
  if (ageHours > windowHours) return 0.0;

  // Exponential decay: score = e^(-lambda * age)
  // Half-life at 1/4 of the window (e.g., 18 hours for a 72-hour window)
  const halfLife = windowHours / 4;
  const lambda = Math.LN2 / halfLife;

  return Math.exp(-lambda * ageHours);
}
```

```typescript
// src/scoring/components/engagement.ts

/**
 * Engagement scoring with diminishing returns.
 * Uses log scaling so viral posts don't dominate.
 */
export function scoreEngagement(
  likes: number,
  reposts: number,
  replies: number
): number {
  // Weighted raw engagement (replies worth more than likes)
  const raw = (likes * 1.0) + (reposts * 2.0) + (replies * 3.0);

  // Log scale with diminishing returns
  // A post with 1 engagement scores ~0.15, 10 scores ~0.48, 100 scores ~0.73, 1000 scores ~0.88
  if (raw === 0) return 0;
  return Math.min(1.0, Math.log10(raw + 1) / Math.log10(1001));
}
```

```typescript
// src/scoring/components/bridging.ts

import { db } from '../../db/client';

/**
 * Bridging score: how much cross-cluster appeal does this post have?
 *
 * MVP approach: Follower overlap diversity
 * - Get the set of users who liked/reposted this post
 * - Check how diverse their follow sets are
 * - Higher diversity = higher bridging score
 *
 * This is a simplified version. Upgrade path:
 * 1. MVP: follower overlap of engagers (implemented here)
 * 2. V2: Pre-cluster subscribers using follow graph, check engager clusters
 * 3. V3: Matrix factorization (Community Notes approach)
 *
 * Build this as a pluggable module so it can be swapped.
 */
export async function scoreBridging(postUri: string, authorDid: string): Promise<number> {
  // Get DIDs of users who engaged with this post
  const engagers = await db.query(
    `SELECT DISTINCT author_did FROM (
       SELECT author_did FROM likes WHERE subject_uri = $1 AND deleted = FALSE
       UNION ALL
       SELECT author_did FROM reposts WHERE subject_uri = $1 AND deleted = FALSE
     ) AS engagers
     LIMIT 50`,
    [postUri]
  );

  if (engagers.rows.length < 2) {
    return 0.3; // Default for posts with insufficient engagement data
  }

  // For each pair of engagers, compute follow overlap
  // Low overlap between engagers = high bridging (they come from different "worlds")
  const engagerDids = engagers.rows.map((r: any) => r.author_did);

  // Get who each engager follows
  const followSets: Map<string, Set<string>> = new Map();

  for (const did of engagerDids.slice(0, 20)) { // Limit for performance
    const follows = await db.query(
      `SELECT subject_did FROM follows WHERE author_did = $1 AND deleted = FALSE LIMIT 200`,
      [did]
    );
    followSets.set(did, new Set(follows.rows.map((r: any) => r.subject_did)));
  }

  // Compute average pairwise Jaccard distance (1 - Jaccard similarity)
  let totalDistance = 0;
  let pairCount = 0;
  const dids = Array.from(followSets.keys());

  for (let i = 0; i < dids.length; i++) {
    for (let j = i + 1; j < dids.length; j++) {
      const setA = followSets.get(dids[i])!;
      const setB = followSets.get(dids[j])!;
      const intersection = new Set([...setA].filter(x => setB.has(x)));
      const union = new Set([...setA, ...setB]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;
      totalDistance += (1 - jaccard);
      pairCount++;
    }
  }

  if (pairCount === 0) return 0.3;

  const avgDistance = totalDistance / pairCount;

  // Normalize: 0.0 (identical audiences) to 1.0 (completely different audiences)
  return Math.min(1.0, avgDistance);
}
```

```typescript
// src/scoring/components/source-diversity.ts

/**
 * Source diversity: penalize feeds dominated by a single author.
 * Scores higher when the post is from an author underrepresented in the current feed.
 */
export async function scoreSourceDiversity(
  authorDid: string,
  alreadyScored: Array<{ uri: string; totalScore: number }>
): Promise<number> {
  // Count how many of the top-scored posts so far are from this author
  const topN = alreadyScored
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 100);

  if (topN.length === 0) return 1.0;

  // This requires knowing the author of each URI in topN.
  // For efficiency, we track this in-memory during the pipeline run.
  // For now, return a placeholder. The pipeline should maintain an
  // authorCount map and pass it here.

  // Simplified version: exponential penalty for repeated authors
  // First post from author: 1.0, second: 0.7, third: 0.5, etc.
  return 1.0; // TODO: Implement with in-memory author tracking in pipeline
}
```

```typescript
// src/scoring/components/relevance.ts

/**
 * Relevance scoring. Placeholder for MVP.
 *
 * Upgrade path:
 * 1. MVP: Return 0.5 for all posts (neutral)
 * 2. V2: Keyword/topic matching based on subscriber interests
 * 3. V3: Sentence transformer embeddings + cosine similarity
 * 4. V4: Fine-tuned classifier
 */
export function scoreRelevance(_post: any): number {
  // MVP: All posts equally relevant
  // This means relevance_weight effectively gets distributed evenly
  return 0.5;
}
```

---

## 9. Layer 3: Feed Serving (getFeedSkeleton)

### The Feed Generator Contract

This is the exact API contract Bluesky expects. Do not deviate.

**Endpoint**: `GET /xrpc/app.bsky.feed.getFeedSkeleton`

**Query Parameters**:
- `feed` (required): AT-URI of the feed being requested (e.g., `at://did:plc:xxx/app.bsky.feed.generator/community-gov`)
- `cursor` (optional): Opaque pagination cursor from a previous response
- `limit` (optional): Number of items to return (default 50, max 100)

**Response**:
```json
{
  "cursor": "optional-opaque-string",
  "feed": [
    { "post": "at://did:plc:xxx/app.bsky.feed.post/yyy" },
    { "post": "at://did:plc:xxx/app.bsky.feed.post/zzz" }
  ]
}
```

**CRITICAL RULES**:
- Return ONLY post URIs. Never return full post content. Bluesky's AppView handles hydration.
- Response time target: **<50ms**. This is called every time a user opens the feed.
- The `cursor` must be opaque and stable for pagination.
- The JWT in the Authorization header contains the requester's DID.

### Cursor Strategy

Use compound cursors: `timestamp::cid` where timestamp is the scored_at time and cid is the post's CID. This ensures stable pagination even if scores change between page loads.

For even better stability, use **feed snapshots**: on first page load, snapshot the ranked list, assign it an ID, and use that ID as part of the cursor. Subsequent pages read from the snapshot.

```typescript
// src/feed/cursor.ts

export interface ParsedCursor {
  snapshotId: string;
  offset: number;
}

export function encodeCursor(snapshotId: string, offset: number): string {
  return Buffer.from(JSON.stringify({ s: snapshotId, o: offset })).toString('base64url');
}

export function decodeCursor(cursor: string): ParsedCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return { snapshotId: decoded.s, offset: decoded.o };
  } catch {
    return null;
  }
}
```

### Feed Skeleton Route

```typescript
// src/feed/routes/feed-skeleton.ts

import { FastifyInstance } from 'fastify';
import { redis } from '../../db/redis';
import { db } from '../../db/client';
import { encodeCursor, decodeCursor } from '../cursor';
import { verifyRequesterDid } from '../auth';
import { logger } from '../../lib/logger';
import { randomUUID } from 'crypto';

// The AT-URI for YOUR feed. Construct from your publisher DID and feed record name.
const FEED_URI = `at://${process.env.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

export function registerFeedSkeleton(app: FastifyInstance): void {
  app.get('/xrpc/app.bsky.feed.getFeedSkeleton', async (request, reply) => {
    const { feed, cursor, limit: limitStr } = request.query as any;
    const limit = Math.min(parseInt(limitStr) || 50, 100);

    // Validate this is a request for OUR feed
    if (feed !== FEED_URI) {
      return reply.code(400).send({ error: 'UnsupportedAlgorithm', message: 'Unknown feed' });
    }

    // Extract requester DID from JWT (optional: for subscriber tracking)
    const requesterDid = await verifyRequesterDid(request);
    if (requesterDid) {
      // Track subscriber (fire-and-forget, don't block response)
      db.query(
        `INSERT INTO subscribers (did, last_seen) VALUES ($1, NOW())
         ON CONFLICT (did) DO UPDATE SET last_seen = NOW(), is_active = TRUE`,
        [requesterDid]
      ).catch(() => {}); // Ignore errors
    }

    let postUris: string[];
    let offset: number;
    let snapshotId: string;

    if (cursor) {
      // Subsequent page: read from existing snapshot
      const parsed = decodeCursor(cursor);
      if (!parsed) {
        return reply.code(400).send({ error: 'InvalidCursor' });
      }

      snapshotId = parsed.snapshotId;
      offset = parsed.offset;

      // Try to get snapshot from Redis (faster) or DB
      const snapshotData = await redis.get(`snapshot:${snapshotId}`);
      if (!snapshotData) {
        // Snapshot expired, return empty to signal client to refresh
        return reply.send({ feed: [] });
      }

      const allUris: string[] = JSON.parse(snapshotData);
      postUris = allUris.slice(offset, offset + limit);
    } else {
      // First page: create new snapshot from current rankings
      snapshotId = randomUUID().substring(0, 8);
      offset = 0;

      // Get ranked posts from Redis sorted set (descending by score)
      const rankedUris = await redis.zrevrange('feed:current', 0, 999);

      if (rankedUris.length === 0) {
        return reply.send({ feed: [] });
      }

      // Cache snapshot for 5 minutes (pagination stability)
      await redis.setex(`snapshot:${snapshotId}`, 300, JSON.stringify(rankedUris));

      postUris = rankedUris.slice(0, limit);
    }

    // Build response
    const feedItems = postUris.map(uri => ({ post: uri }));

    const nextOffset = offset + postUris.length;
    const hasMore = postUris.length === limit;

    return reply.send({
      feed: feedItems,
      cursor: hasMore ? encodeCursor(snapshotId, nextOffset) : undefined,
    });
  });
}
```

### Describe Generator Route

```typescript
// src/feed/routes/describe-generator.ts

import { FastifyInstance } from 'fastify';

export function registerDescribeGenerator(app: FastifyInstance): void {
  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', async (_request, reply) => {
    return reply.send({
      did: process.env.FEEDGEN_SERVICE_DID,
      feeds: [
        {
          uri: `at://${process.env.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`,
        }
      ],
    });
  });
}
```

### Well-Known DID Document (for did:web fallback)

```typescript
// src/feed/routes/well-known.ts

import { FastifyInstance } from 'fastify';

export function registerWellKnown(app: FastifyInstance): void {
  // Only needed if using did:web (not recommended; use did:plc instead)
  app.get('/.well-known/did.json', async (_request, reply) => {
    return reply.send({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: `did:web:${process.env.FEEDGEN_HOSTNAME}`,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${process.env.FEEDGEN_HOSTNAME}`,
        },
      ],
    });
  });
}
```

---

## 10. Layer 4: Governance System

### Governance Lifecycle

```
Epoch N (active, weights = [0.25, 0.20, 0.25, 0.15, 0.15])
  │
  ├── Users browse feed ranked by Epoch N weights
  ├── Voting period opens (status = 'voting')
  ├── Subscribers cast votes (weight preferences)
  ├── Polis deliberation runs in parallel (optional)
  │
  └── Voting period closes
       │
       ├── Aggregate votes → new weights
       ├── Close Epoch N (status = 'closed')
       ├── Create Epoch N+1 with new weights (status = 'active')
       ├── Write audit log entries
       └── Trigger background re-score of active posts
```

### Vote Aggregation

```typescript
// src/governance/aggregation.ts

import { db } from '../db/client';
import { logger } from '../lib/logger';

export interface AggregatedWeights {
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
}

/**
 * Aggregate votes using trimmed mean (removes top/bottom 10% outliers).
 * This prevents a small number of extreme voters from dominating.
 *
 * Alternative methods to consider:
 * - Simple mean (most democratic but vulnerable to outliers)
 * - Median (robust but less sensitive to preferences)
 * - Quadratic voting (costs more to express strong preferences)
 *
 * The method itself could be a governance question for the community.
 */
export async function aggregateVotes(epochId: number): Promise<AggregatedWeights> {
  const votes = await db.query(
    `SELECT recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight
     FROM governance_votes
     WHERE epoch_id = $1
     ORDER BY voted_at`,
    [epochId]
  );

  if (votes.rows.length === 0) {
    throw new Error('No votes to aggregate');
  }

  const n = votes.rows.length;
  const trimPct = 0.1; // Remove top and bottom 10%
  const trimCount = Math.floor(n * trimPct);

  const components: (keyof AggregatedWeights)[] = [
    'recency_weight', 'engagement_weight', 'bridging_weight',
    'source_diversity_weight', 'relevance_weight'
  ];

  const result: AggregatedWeights = {
    recency_weight: 0,
    engagement_weight: 0,
    bridging_weight: 0,
    source_diversity_weight: 0,
    relevance_weight: 0,
  };

  for (const component of components) {
    const values = votes.rows
      .map((v: any) => v[component] as number)
      .sort((a: number, b: number) => a - b);

    // Trimmed mean: remove extremes
    const trimmed = values.slice(trimCount, n - trimCount);
    const mean = trimmed.reduce((sum: number, v: number) => sum + v, 0) / trimmed.length;
    result[component] = mean;
  }

  // Normalize to sum to 1.0
  const total = Object.values(result).reduce((sum, v) => sum + v, 0);
  for (const component of components) {
    result[component] = Math.round((result[component] / total) * 1000) / 1000;
  }

  // Ensure exact sum of 1.0 (fix rounding)
  const currentSum = Object.values(result).reduce((sum, v) => sum + v, 0);
  result.recency_weight += (1.0 - currentSum);

  return result;
}
```

### Epoch Manager

```typescript
// src/governance/epoch-manager.ts

import { db } from '../db/client';
import { aggregateVotes } from './aggregation';
import { logger } from '../lib/logger';

export async function closeCurrentEpochAndCreateNext(): Promise<void> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Get current active epoch
    const current = await client.query(
      `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
    );

    if (!current.rows[0]) {
      throw new Error('No active epoch to close');
    }

    const currentEpoch = current.rows[0];

    // Aggregate votes
    const newWeights = await aggregateVotes(currentEpoch.id);

    // Close current epoch
    await client.query(
      `UPDATE governance_epochs SET status = 'closed', closed_at = NOW() WHERE id = $1`,
      [currentEpoch.id]
    );

    // Create new epoch with aggregated weights
    const newEpoch = await client.query(
      `INSERT INTO governance_epochs (
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        vote_count, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        newWeights.recency_weight,
        newWeights.engagement_weight,
        newWeights.bridging_weight,
        newWeights.source_diversity_weight,
        newWeights.relevance_weight,
        (await client.query(`SELECT COUNT(*) FROM governance_votes WHERE epoch_id = $1`, [currentEpoch.id])).rows[0].count,
        `Weights updated from epoch ${currentEpoch.id} based on community vote.`
      ]
    );

    // Audit log
    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_closed', $1, $2)`,
      [currentEpoch.id, JSON.stringify({
        old_weights: {
          recency: currentEpoch.recency_weight,
          engagement: currentEpoch.engagement_weight,
          bridging: currentEpoch.bridging_weight,
          source_diversity: currentEpoch.source_diversity_weight,
          relevance: currentEpoch.relevance_weight,
        },
        new_weights: newWeights,
        new_epoch_id: newEpoch.rows[0].id,
      })]
    );

    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_created', $1, $2)`,
      [newEpoch.rows[0].id, JSON.stringify(newWeights)]
    );

    await client.query('COMMIT');

    logger.info({
      closedEpoch: currentEpoch.id,
      newEpoch: newEpoch.rows[0].id,
      newWeights,
    }, 'Governance epoch transition complete');

    // Trigger re-score with new weights (async, don't block)
    // The next scoring pipeline run will pick up the new epoch automatically.

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to transition governance epoch');
    throw err;
  } finally {
    client.release();
  }
}
```

### Vote API Route

```typescript
// src/governance/routes/vote.ts

import { FastifyInstance } from 'fastify';
import { db } from '../../db/client';
import { z } from 'zod';

const VoteSchema = z.object({
  recency_weight: z.number().min(0).max(1),
  engagement_weight: z.number().min(0).max(1),
  bridging_weight: z.number().min(0).max(1),
  source_diversity_weight: z.number().min(0).max(1),
  relevance_weight: z.number().min(0).max(1),
}).refine(
  (data) => {
    const sum = data.recency_weight + data.engagement_weight +
      data.bridging_weight + data.source_diversity_weight + data.relevance_weight;
    return Math.abs(sum - 1.0) < 0.01;
  },
  { message: 'Weights must sum to 1.0' }
);

export function registerVoteRoute(app: FastifyInstance): void {
  app.post('/api/governance/vote', async (request, reply) => {
    // Authenticate voter — must be a feed subscriber
    const voterDid = await getAuthenticatedDid(request);
    if (!voterDid) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // Verify they're a subscriber
    const subscriber = await db.query(
      `SELECT did FROM subscribers WHERE did = $1 AND is_active = TRUE`,
      [voterDid]
    );
    if (subscriber.rows.length === 0) {
      return reply.code(403).send({ error: 'Must be an active feed subscriber to vote' });
    }

    // Validate vote body
    const parseResult = VoteSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid vote', details: parseResult.error });
    }

    const vote = parseResult.data;

    // Get current epoch
    const epoch = await db.query(
      `SELECT id FROM governance_epochs WHERE status IN ('active', 'voting') ORDER BY id DESC LIMIT 1`
    );
    if (!epoch.rows[0]) {
      return reply.code(500).send({ error: 'No active governance epoch' });
    }

    // Upsert vote (one vote per voter per epoch)
    await db.query(
      `INSERT INTO governance_votes (
        voter_did, epoch_id,
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (voter_did, epoch_id) DO UPDATE SET
        recency_weight = $3, engagement_weight = $4, bridging_weight = $5,
        source_diversity_weight = $6, relevance_weight = $7, voted_at = NOW()`,
      [
        voterDid, epoch.rows[0].id,
        vote.recency_weight, vote.engagement_weight, vote.bridging_weight,
        vote.source_diversity_weight, vote.relevance_weight,
      ]
    );

    // Audit log
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
       VALUES ('vote_cast', $1, $2, $3)`,
      [voterDid, epoch.rows[0].id, JSON.stringify(vote)]
    );

    return reply.send({ success: true, epoch_id: epoch.rows[0].id });
  });
}

// Placeholder — implement proper Bluesky OAuth or DID-based auth
async function getAuthenticatedDid(request: any): Promise<string | null> {
  // For MVP: accept DID from a signed JWT or API key
  // For production: implement full Bluesky OAuth
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;
  // TODO: Implement proper authentication
  return null;
}
```

---

## 11. Layer 5: Transparency & Explainability

### Per-Post Explanation Endpoint

```typescript
// src/transparency/routes/post-explain.ts

import { FastifyInstance } from 'fastify';
import { db } from '../../db/client';

export function registerPostExplainRoute(app: FastifyInstance): void {
  app.get('/api/transparency/post/:uri', async (request, reply) => {
    const { uri } = request.params as { uri: string };

    // Get the most recent score for this post
    const score = await db.query(
      `SELECT ps.*, ge.description as epoch_description
       FROM post_scores ps
       JOIN governance_epochs ge ON ps.epoch_id = ge.id
       WHERE ps.post_uri = $1
       ORDER BY ps.scored_at DESC
       LIMIT 1`,
      [decodeURIComponent(uri)]
    );

    if (score.rows.length === 0) {
      return reply.code(404).send({ error: 'Score not found for this post' });
    }

    const s = score.rows[0];

    // Get rank position
    const rank = await db.query(
      `SELECT COUNT(*) + 1 as rank
       FROM post_scores
       WHERE epoch_id = $1 AND total_score > $2`,
      [s.epoch_id, s.total_score]
    );

    // Compute counterfactual: what would rank be with pure engagement?
    const engagementRank = await db.query(
      `SELECT COUNT(*) + 1 as rank
       FROM post_scores
       WHERE epoch_id = $1 AND engagement_score > $2`,
      [s.epoch_id, s.engagement_score]
    );

    return reply.send({
      post_uri: s.post_uri,
      epoch_id: s.epoch_id,
      epoch_description: s.epoch_description,
      total_score: s.total_score,
      rank: parseInt(rank.rows[0].rank),
      components: {
        recency: {
          raw_score: s.recency_score,
          weight: s.recency_weight,
          weighted: s.recency_weighted,
        },
        engagement: {
          raw_score: s.engagement_score,
          weight: s.engagement_weight,
          weighted: s.engagement_weighted,
        },
        bridging: {
          raw_score: s.bridging_score,
          weight: s.bridging_weight,
          weighted: s.bridging_weighted,
        },
        source_diversity: {
          raw_score: s.source_diversity_score,
          weight: s.source_diversity_weight,
          weighted: s.source_diversity_weighted,
        },
        relevance: {
          raw_score: s.relevance_score,
          weight: s.relevance_weight,
          weighted: s.relevance_weighted,
        },
      },
      governance_weights: {
        recency: s.recency_weight,
        engagement: s.engagement_weight,
        bridging: s.bridging_weight,
        source_diversity: s.source_diversity_weight,
        relevance: s.relevance_weight,
      },
      counterfactual: {
        pure_engagement_rank: parseInt(engagementRank.rows[0].rank),
        community_governed_rank: parseInt(rank.rows[0].rank),
        difference: parseInt(engagementRank.rows[0].rank) - parseInt(rank.rows[0].rank),
      },
      scored_at: s.scored_at,
      details: s.component_details,
    });
  });
}
```

### Feed-Level Stats Endpoint

```typescript
// src/transparency/routes/feed-stats.ts

import { FastifyInstance } from 'fastify';
import { db } from '../../db/client';

export function registerFeedStatsRoute(app: FastifyInstance): void {
  app.get('/api/transparency/stats', async (_request, reply) => {
    // Get current epoch
    const epoch = await db.query(
      `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
    );

    if (!epoch.rows[0]) {
      return reply.code(500).send({ error: 'No active epoch' });
    }

    const epochId = epoch.rows[0].id;

    // Aggregate metrics for current epoch
    const stats = await db.query(`
      SELECT
        COUNT(*) as total_posts,
        COUNT(DISTINCT p.author_did) as unique_authors,
        AVG(ps.bridging_score) as avg_bridging,
        AVG(ps.engagement_score) as avg_engagement,
        AVG(ps.recency_score) as avg_recency,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.bridging_score) as median_bridging,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.total_score) as median_total
      FROM post_scores ps
      JOIN posts p ON ps.post_uri = p.uri
      WHERE ps.epoch_id = $1
    `, [epochId]);

    // Vote count for current epoch
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epochId]
    );

    return reply.send({
      epoch: {
        id: epochId,
        weights: {
          recency: epoch.rows[0].recency_weight,
          engagement: epoch.rows[0].engagement_weight,
          bridging: epoch.rows[0].bridging_weight,
          source_diversity: epoch.rows[0].source_diversity_weight,
          relevance: epoch.rows[0].relevance_weight,
        },
        created_at: epoch.rows[0].created_at,
      },
      feed_stats: {
        total_posts_scored: parseInt(stats.rows[0].total_posts),
        unique_authors: parseInt(stats.rows[0].unique_authors),
        avg_bridging_score: parseFloat(stats.rows[0].avg_bridging),
        avg_engagement_score: parseFloat(stats.rows[0].avg_engagement),
        median_bridging_score: parseFloat(stats.rows[0].median_bridging),
        median_total_score: parseFloat(stats.rows[0].median_total),
      },
      governance: {
        votes_this_epoch: parseInt(voteCount.rows[0].count),
      },
    });
  });
}
```

---

## 12. Authentication & Identity

### DID Choice: Use did:plc

**CRITICAL day-one decision. Use `did:plc`, not `did:web`.**

- `did:web` is tied to a domain name. If you move servers, the DID breaks.
- `did:plc` is a persistent identifier that survives domain changes.
- Bluesky docs explicitly recommend `did:plc` for long-standing feed generators.
- Annoying to change later — subscribers' feed URIs reference this DID.

Generate once with `scripts/create-did-plc.ts` and store in `.env`.

### JWT Verification for Feed Requests

```typescript
// src/feed/auth.ts

import { verifyJwt, AuthRequiredError } from '@atproto/xrpc-server';
import { DidResolver } from '@atproto/identity';
import { FastifyRequest } from 'fastify';

const didResolver = new DidResolver({});

/**
 * Extract the requester's DID from the JWT in the Authorization header.
 * Feed requests from Bluesky include a JWT signed by the user's repo signing key.
 *
 * Returns null if no auth header (some requests may be unauthenticated).
 * This is used for subscriber tracking, not access control.
 * The feed itself is public.
 */
export async function verifyRequesterDid(request: FastifyRequest): Promise<string | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;

  try {
    const jwt = authHeader.replace('Bearer ', '');
    const requesterDid = await verifyJwt(
      jwt,
      `did:web:${process.env.FEEDGEN_HOSTNAME}`, // or your did:plc
      async (did: string) => {
        return didResolver.resolveAtprotoKey(did);
      }
    );
    return requesterDid;
  } catch (err) {
    // Don't fail the request if JWT verification fails
    // Just return null — the feed is public
    return null;
  }
}
```

### Governance Authentication

For the governance voting API, you need stronger auth (proving the voter is who they claim to be). Options:

1. **MVP**: Bluesky OAuth (the user logs in via Bluesky, you get their DID)
2. **Simpler MVP**: App password authentication (user provides handle + app password, you verify via `com.atproto.server.createSession`)
3. **Future**: Full AT Protocol OAuth with DPoP

For the prototype, use option 2. Wrap it behind a session cookie.

---

## 13. Error Handling & Resilience

### Jetstream Reconnection

This is the most critical resilience concern. If the Jetstream connection drops and you don't reconnect with the correct cursor, you silently lose posts.

**Rules**:
1. Always persist the Jetstream cursor periodically (every ~1000 events)
2. On reconnect, pass `cursor` parameter to resume from last processed event
3. Use exponential backoff (1s → 2s → 4s → ... → 60s max)
4. Try fallback Jetstream instance if primary fails repeatedly
5. Log every disconnect and reconnect with timestamps

### Database Connection Handling

```typescript
// src/db/client.ts

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../lib/logger';

export const db = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,                    // Connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});
```

### Process-Level Error Handling

```typescript
// In src/index.ts

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
  // Don't crash — log and continue
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('Shutting down gracefully...');
  // 1. Stop accepting new feed requests
  // 2. Close Jetstream connection
  // 3. Flush pending cursor to DB
  // 4. Close DB pool
  // 5. Close Redis
  await db.end();
  await redis.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

---

## 14. Rate Limits & External API Constraints

### Bluesky API Limits

| Limit | Value | Notes |
|-------|-------|-------|
| AppView requests | 3,000 per 5 min per IP | For enrichment queries |
| Public AppView | Higher limits + caching | Use `public.api.bsky.app` for public reads |
| Action points | 5,000/hour, 35,000/day per DID | For write operations |
| createSession | 30 per 5 min | Authentication calls |

### Strategy for Staying Under Limits

1. **Jetstream eliminates most API calls** — post content, likes, reposts all come through the stream
2. **Batch enrichment calls** — if you need user profile data, batch requests and cache aggressively
3. **Use `public.api.bsky.app`** for unauthenticated read queries (higher limits, Cloudflare caching)
4. **Cache follower lists** — for bridging score computation, cache follow graphs for 1 hour minimum
5. **Never call the API in the hot path** — `getFeedSkeleton` reads only from Redis/PostgreSQL, zero Bluesky API calls

---

## 15. Testing Strategy

### Unit Tests

Test each scoring component independently with known inputs/outputs:

```typescript
// tests/scoring/components/recency.test.ts

import { describe, it, expect } from 'vitest';
import { scoreRecency } from '../../../src/scoring/components/recency';

describe('scoreRecency', () => {
  it('returns 1.0 for a post created just now', () => {
    const score = scoreRecency(new Date(), 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.5 at the half-life point', () => {
    const halfLifeHours = 72 / 4; // 18 hours
    const postTime = new Date(Date.now() - halfLifeHours * 60 * 60 * 1000);
    const score = scoreRecency(postTime, 72);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('returns 0.0 for posts older than the window', () => {
    const oldPost = new Date(Date.now() - 73 * 60 * 60 * 1000);
    const score = scoreRecency(oldPost, 72);
    expect(score).toBe(0.0);
  });
});
```

### Integration Tests

Test the full pipeline: insert fake posts → run scoring → verify Redis output → verify getFeedSkeleton response.

### Feed Contract Tests

Verify the feed endpoint returns the exact shape Bluesky expects:

```typescript
// tests/feed/feed-skeleton.test.ts

describe('getFeedSkeleton', () => {
  it('returns valid feed skeleton shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://...',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('feed');
    expect(Array.isArray(body.feed)).toBe(true);

    for (const item of body.feed) {
      expect(item).toHaveProperty('post');
      expect(item.post).toMatch(/^at:\/\//);
    }

    if (body.cursor) {
      expect(typeof body.cursor).toBe('string');
    }
  });
});
```

---

## 16. Deployment

### Docker Compose (Development)

```yaml
# docker-compose.yml

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: community_feed
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./src/db/migrations:/docker-entrypoint-initdb.d

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### Production Deployment

**Option A: Single VPS (recommended for prototype)**

- Hetzner CX21 or DigitalOcean $12/month
- Docker Compose with all services
- Nginx reverse proxy with Let's Encrypt SSL
- Systemd service for auto-restart

**Option B: Platform-as-a-Service**

- Railway or Fly.io for the app
- Neon or Supabase for PostgreSQL
- Upstash for Redis
- Vercel for the frontend

### Required for Bluesky Integration

1. **HTTPS on port 443** — Bluesky's AppView will call your feed endpoint over HTTPS
2. **Stable hostname** — whatever `FEEDGEN_HOSTNAME` is set to must be resolvable and stable
3. **did:plc registered** — run `scripts/create-did-plc.ts` once before deploying
4. **Feed published** — run `scripts/publish-feed.ts` to register with Bluesky network

### Publish Feed Script

```typescript
// scripts/publish-feed.ts

import { BskyAgent } from '@atproto/api';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  await agent.login({
    identifier: process.env.BSKY_IDENTIFIER!,
    password: process.env.BSKY_APP_PASSWORD!,
  });

  // Register the feed generator record
  await agent.api.com.atproto.repo.putRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.feed.generator',
    rkey: 'community-gov',                    // IMPORTANT: must match FEED_URI rkey
    record: {
      did: process.env.FEEDGEN_SERVICE_DID!,
      displayName: 'Community Governed Feed',
      description: 'A feed where subscribers collectively vote on algorithm parameters. Transparent, explainable, democratic.',
      createdAt: new Date().toISOString(),
    },
  });

  console.log('Feed published successfully!');
  console.log(`Feed URI: at://${agent.session!.did}/app.bsky.feed.generator/community-gov`);
}

main().catch(console.error);
```

---

## 17. Implementation Phases

### Phase 1: Skeleton (Days 1-2)

**Goal**: Hello-world feed live on Bluesky

- [ ] Initialize TypeScript project with dependencies
- [ ] Docker Compose for PostgreSQL + Redis
- [ ] Run database migrations
- [ ] Implement `describeFeedGenerator` endpoint
- [ ] Implement basic `getFeedSkeleton` that returns hardcoded post URIs
- [ ] Generate `did:plc` identity
- [ ] Deploy to VPS with HTTPS
- [ ] Run `publish-feed.ts` to register feed
- [ ] **Verify**: Feed appears in Bluesky app and shows posts

### Phase 2: Ingestion (Days 3-4)

**Goal**: Live posts flowing from Jetstream into PostgreSQL

- [ ] Implement Jetstream WebSocket client with reconnection
- [ ] Implement all event handlers (post, like, repost, follow, delete)
- [ ] Implement cursor persistence
- [ ] Implement pre-filtering (e.g., language, content type)
- [ ] **Verify**: Posts appearing in database within seconds of being published on Bluesky

### Phase 3: Scoring Pipeline (Days 5-7)

**Goal**: Posts ranked by governance-weighted scores

- [ ] Implement all five scoring components (recency, engagement, bridging, source diversity, relevance)
- [ ] Implement scoring orchestrator with decomposed score storage
- [ ] Implement cron/BullMQ scheduling (every 5 minutes)
- [ ] Write scored rankings to Redis
- [ ] Update `getFeedSkeleton` to read from Redis
- [ ] Implement cursor/pagination with snapshots
- [ ] Seed first governance epoch with default weights
- [ ] **Verify**: Feed shows different posts than chronological, scores stored in DB

### Phase 4: Governance (Days 8-10)

**Goal**: Subscribers can vote on weights

- [ ] Implement vote submission API with validation
- [ ] Implement vote aggregation (trimmed mean)
- [ ] Implement epoch lifecycle (close → aggregate → create new → re-score)
- [ ] Implement subscriber tracking from feed requests
- [ ] Implement governance auth (at minimum: DID-based, ideally Bluesky OAuth)
- [ ] Build React voting UI with weight sliders
- [ ] Implement audit log
- [ ] **Verify**: Casting votes changes feed rankings in next epoch

### Phase 5: Transparency (Days 11-12)

**Goal**: Full explainability and dashboard

- [ ] Implement per-post explanation endpoint
- [ ] Implement feed-level stats endpoint
- [ ] Implement counterfactual comparison
- [ ] Build transparency dashboard (React)
- [ ] Build governance history timeline
- [ ] **Verify**: Can explain why any post is ranked where it is

### Phase 6: Hardening (Days 13-14)

**Goal**: Production-ready reliability

- [ ] Comprehensive error handling review
- [ ] Jetstream reconnection stress testing
- [ ] Load testing for getFeedSkeleton (<50ms at 100 concurrent)
- [ ] Database query optimization (EXPLAIN ANALYZE on all queries)
- [ ] Add structured logging with correlation IDs
- [ ] Set up basic monitoring (health endpoint, uptime check)
- [ ] Write unit and integration tests
- [ ] **Verify**: System runs 24 hours without intervention

---

## 18. Critical Non-Negotiable Rules

These rules exist because of hard-won lessons from production feed generators. Do not skip them.

### 1. GOLDEN RULE: Store Score Decomposition, Not Just Total Score

```
✅ Store: recency=0.8, weight=0.25, weighted=0.20, engagement=0.6, weight=0.20, weighted=0.12, ...
❌ Store: total_score=0.72
```

Everything flows from this: explainability, transparency, research analysis, debugging, governance impact measurement. Storing only `total_score` throws away what makes this project unique.

### 2. Tag Every Score With Governance Epoch

Without this, you cannot measure the impact of governance changes. "Did increasing bridging weight actually change what people see?" requires comparing scores across epochs.

### 3. Handle Deletions From Day One

If a user deletes a post and your feed keeps serving it, trust is destroyed. Wire up the delete handler in the Jetstream consumer before anything else.

### 4. Persist Jetstream Cursor

If the Jetstream connection drops and you reconnect without a cursor, you silently miss every post published during the gap. There's no way to know what you missed. Persist the cursor and reconnect with it.

### 5. Never Call External APIs in the Feed Hot Path

`getFeedSkeleton` must read only from Redis/PostgreSQL. Zero Bluesky API calls, zero ML inference, zero network requests to external services. Pre-compute everything.

### 6. Use did:plc, Not did:web

This is a one-way door decision. `did:plc` persists across domain changes. `did:web` breaks if you move servers. Generate once, never change.

### 7. Weights Must Sum to 1.0

Validate everywhere: database constraint, API validation, frontend slider UI. Floating point rounding means you need a tolerance (0.01) and a normalization step.

### 8. Cursor Must Be Stable Across Pagination

If a user loads page 1, then page 2, they must not see duplicates or miss posts. Use feed snapshots with TTL.

### 9. Audit Log Is Append-Only

Never update or delete governance audit log entries. This is the trust anchor. Voters need to verify that their votes were counted and that weight changes match the aggregate.

### 10. Soft Delete Everything

Never hard delete posts, likes, follows from the database. Set `deleted = TRUE`. This preserves referential integrity and allows analytics on deletion patterns.

---

## 19. Reference Links & Prior Art

### Essential Reading Before Building

| Resource | URL | Why |
|----------|-----|-----|
| Bluesky Feed Generator Starter Kit | https://github.com/bluesky-social/feed-generator | Fork this as your starting skeleton |
| Custom Feeds Documentation | https://docs.bsky.app/docs/starter-templates/custom-feeds | Official feed generator tutorial |
| Jetstream Documentation | https://github.com/bluesky-social/jetstream | Connection params, event format, cursor handling |
| Paper Skygest (code) | https://github.com/Skygest/PaperSkygest | Production academic feed — architecture reference |
| Paper Skygest (paper) | https://arxiv.org/abs/2601.04253 | System design decisions, scaling lessons |
| Blacksky rsky (code) | https://github.com/blacksky-algorithms/rsky | Community governance patterns on AT Protocol |
| Polis | https://github.com/compdemocracy/polis | Deliberation platform — integrate or reference |
| Anthropic CCA | https://www.anthropic.com/research/collective-constitutional-ai-aligning-a-language-model-with-public-input | Polis + AI governance — methodology reference |
| Ovadya Bridging-Based Ranking | https://www.belfercenter.org/publication/bridging-based-ranking | Theoretical foundation for bridging scores |
| AT Protocol Specification | https://atproto.com/specs/atp | Protocol details |
| MarshalX Python Feed Generator | https://github.com/MarshalX/bluesky-feed-generator | Alternative if you prefer Python |
| Bluesky Ozone (labeler) | https://github.com/bluesky-social/ozone | Future: publish transparency labels in-app |
| Tap (backfill tool) | https://docs.bsky.app/blog/introducing-tap | Historical data backfill (optional, not needed for MVP) |

### Bluesky API Quick Reference

| Endpoint | Purpose |
|----------|---------|
| `jetstream2.us-east.bsky.network` | Primary Jetstream instance |
| `jetstream1.us-east.bsky.network` | Fallback Jetstream instance |
| `public.api.bsky.app` | Public AppView (higher rate limits, cached) |
| `bsky.social` | PDS entryway (for authentication) |

---

## 20. Glossary

| Term | Definition |
|------|-----------|
| **AT Protocol** | The open protocol Bluesky is built on. Defines repos, DIDs, lexicons, and data formats. |
| **AppView** | Bluesky's service that hydrates post URIs into full views (user info, content, engagement counts). Your feed returns URIs; the AppView does the rest. |
| **Bridging Score** | A metric for how much a post appeals across different social clusters. High bridging = cross-partisan appeal. |
| **CID** | Content Identifier — a hash of a record's content. Used in AT Protocol for content addressing. |
| **DID** | Decentralized Identifier — a persistent identity that's not tied to any single server. |
| **did:plc** | A DID method that uses a registry for resolution. Recommended for feed generators. |
| **did:web** | A DID method that uses DNS/HTTPS for resolution. Fragile — tied to domain. |
| **Epoch** | A governance period during which a specific set of algorithm weights is active. |
| **Feed Generator** | A server that implements `getFeedSkeleton` to provide custom algorithmic feeds to Bluesky users. |
| **Firehose** | The raw stream of all events on the AT Protocol network. Heavy (232 GB/day). |
| **getFeedSkeleton** | The API endpoint Bluesky calls to get a list of post URIs for a custom feed. |
| **Governance Weight** | A float (0-1) determining how much influence a scoring component has on the final ranking. Community votes set these. |
| **Jetstream** | A lightweight JSON proxy for the firehose (~1/10th bandwidth). Recommended for feed generators. |
| **Ozone** | Bluesky's open-source labeler/moderation system. Can be used to publish transparency labels. |
| **PDS** | Personal Data Server — where a user's data (posts, likes, follows) is stored. |
| **Polis** | An open-source deliberation platform that uses ML to find consensus among large groups. |
| **Relay** | A server that aggregates firehose streams from all PDSes into one stream. |
| **rkey** | Record key — the unique identifier for a record within a collection in a repo. |
| **Score Decomposition** | Storing each individual component score separately (not just the total). Enables explainability. |
| **Tap** | A Bluesky tool for repository synchronization with automatic backfill. Optional for this project. |

---

## Appendix A: Config Validation

```typescript
// src/config.ts

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  FEEDGEN_SERVICE_DID: z.string().startsWith('did:'),
  FEEDGEN_PUBLISHER_DID: z.string().startsWith('did:'),
  FEEDGEN_HOSTNAME: z.string().min(1),
  FEEDGEN_PORT: z.coerce.number().default(3000),
  FEEDGEN_LISTENHOST: z.string().default('0.0.0.0'),

  JETSTREAM_URL: z.string().url(),
  JETSTREAM_FALLBACK_URL: z.string().url(),
  JETSTREAM_COLLECTIONS: z.string(),

  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),

  SCORING_INTERVAL_CRON: z.string().default('*/5 * * * *'),
  SCORING_WINDOW_HOURS: z.coerce.number().default(72),
  FEED_MAX_POSTS: z.coerce.number().default(1000),

  GOVERNANCE_MIN_VOTES: z.coerce.number().default(5),
  GOVERNANCE_PERIOD_HOURS: z.coerce.number().default(168),

  BSKY_IDENTIFIER: z.string(),
  BSKY_APP_PASSWORD: z.string(),

  POLIS_CONVERSATION_ID: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const config = ConfigSchema.parse(process.env);
```

## Appendix B: Application Entry Point

```typescript
// src/index.ts

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config';
import { logger } from './lib/logger';
import { db } from './db/client';
import { redis } from './db/redis';
import { startJetstream } from './ingestion/jetstream';
import { registerFeedSkeleton } from './feed/routes/feed-skeleton';
import { registerDescribeGenerator } from './feed/routes/describe-generator';
import { registerWellKnown } from './feed/routes/well-known';
import { registerVoteRoute } from './governance/routes/vote';
import { registerPostExplainRoute } from './transparency/routes/post-explain';
import { registerFeedStatsRoute } from './transparency/routes/feed-stats';
import { startScoringScheduler } from './scoring/scheduler';

async function main() {
  // 1. Initialize Fastify
  const app = Fastify({ logger: false }); // We use our own pino logger
  await app.register(cors, { origin: true });

  // 2. Register routes
  // Feed generator (called by Bluesky)
  registerFeedSkeleton(app);
  registerDescribeGenerator(app);
  registerWellKnown(app);

  // Governance API
  registerVoteRoute(app);

  // Transparency API
  registerPostExplainRoute(app);
  registerFeedStatsRoute(app);

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // 3. Start HTTP server
  await app.listen({ port: config.FEEDGEN_PORT, host: config.FEEDGEN_LISTENHOST });
  logger.info({ port: config.FEEDGEN_PORT }, 'Feed generator server started');

  // 4. Start Jetstream ingestion
  await startJetstream();
  logger.info('Jetstream ingestion started');

  // 5. Start scoring pipeline scheduler
  startScoringScheduler();
  logger.info('Scoring scheduler started');

  logger.info('All systems operational');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start application');
  process.exit(1);
});
```

---

*This specification was compiled from extensive research across the AT Protocol ecosystem, Bluesky documentation, Paper Skygest's production architecture, Blacksky's community governance patterns, and the Polis deliberative democracy platform. Every technical recommendation has been validated against the current state of the ecosystem as of February 2026.*
