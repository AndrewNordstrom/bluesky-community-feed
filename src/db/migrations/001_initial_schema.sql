-- 001_initial_schema.sql
-- Phase 1: Core tables for posts, engagement, social graph, and feed tracking

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Posts ──────────────────────────────────────────────
-- Every post we index from Jetstream
CREATE TABLE IF NOT EXISTS posts (
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

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_did);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_indexed ON posts(indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_reply_root ON posts(reply_root) WHERE reply_root IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_active ON posts(created_at DESC) WHERE deleted = FALSE;

-- ─── Engagement ─────────────────────────────────────────
-- Aggregated engagement counts per post (updated incrementally)
CREATE TABLE IF NOT EXISTS post_engagement (
    post_uri    TEXT PRIMARY KEY REFERENCES posts(uri) ON DELETE CASCADE,
    like_count  INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Individual engagement events (for bridging analysis) ─────
CREATE TABLE IF NOT EXISTS likes (
    uri         TEXT PRIMARY KEY,           -- at://did:plc:xxx/app.bsky.feed.like/yyy
    author_did  TEXT NOT NULL,              -- Who liked
    subject_uri TEXT NOT NULL,              -- What post was liked
    created_at  TIMESTAMPTZ NOT NULL,
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_likes_subject ON likes(subject_uri);
CREATE INDEX IF NOT EXISTS idx_likes_author ON likes(author_did);

CREATE TABLE IF NOT EXISTS reposts (
    uri         TEXT PRIMARY KEY,
    author_did  TEXT NOT NULL,
    subject_uri TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_reposts_subject ON reposts(subject_uri);

-- ─── Social Graph (for bridging scores) ─────────────────
CREATE TABLE IF NOT EXISTS follows (
    uri         TEXT PRIMARY KEY,           -- at://did:plc:xxx/app.bsky.graph.follow/yyy
    author_did  TEXT NOT NULL,              -- Who is following
    subject_did TEXT NOT NULL,              -- Who they follow
    created_at  TIMESTAMPTZ NOT NULL,
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_follows_author ON follows(author_did) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_follows_subject ON follows(subject_did) WHERE deleted = FALSE;

-- ─── Subscribers ────────────────────────────────────────
-- Track who has subscribed to this feed (for governance eligibility)
-- Populated when users request the feed (from JWT DID)
CREATE TABLE IF NOT EXISTS subscribers (
    did         TEXT PRIMARY KEY,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN DEFAULT TRUE        -- Seen in last 7 days
);

-- ─── Jetstream Cursor ───────────────────────────────────
-- Stores the last processed Jetstream cursor for reconnection
CREATE TABLE IF NOT EXISTS jetstream_cursor (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    cursor_us   BIGINT NOT NULL,            -- Microsecond timestamp cursor
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);
