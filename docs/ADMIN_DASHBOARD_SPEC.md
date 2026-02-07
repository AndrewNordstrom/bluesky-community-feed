# Admin Dashboard Implementation Spec

## Overview

A protected admin interface at `/admin` that lets authorized users manage epochs, scheduling, announcements, and monitor feed health without SSH access.

**Critical Design Requirement:** The admin dashboard UI must match the existing Vote page design language exactly. Reference `web/src/pages/Vote.tsx` and existing styles throughout implementation. Key design elements to maintain:
- Dark background (#161718)
- Card backgrounds (#1e1f21)
- Blue accent (#1083fe)
- Clean typography (-apple-system, 400/600 weights)
- Subtle borders, no gradients
- Tab styling matching Vote page tabs
- Button styling matching existing buttons
- Pill styling matching keyword pills (green include, red exclude)

---

## Phase 1: Database & Auth Foundation

### 1.1 Database Migration

**File: `src/db/migrations/007_epoch_scheduling.sql`**

```sql
-- Add scheduling columns to governance_epochs
ALTER TABLE governance_epochs 
ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS auto_transition BOOLEAN DEFAULT false;

-- Add index for scheduler queries
CREATE INDEX IF NOT EXISTS idx_epochs_voting_ends 
ON governance_epochs (voting_ends_at) 
WHERE voting_ends_at IS NOT NULL AND status = 'active';

-- Track announcement history
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  epoch_id INTEGER REFERENCES governance_epochs(id),
  post_uri TEXT NOT NULL,
  post_cid TEXT NOT NULL,
  content TEXT NOT NULL,
  announcement_type TEXT DEFAULT 'custom', -- 'custom', 'epoch_start', 'epoch_end', 'voting_reminder'
  posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  posted_by TEXT NOT NULL -- admin DID who triggered it, or 'system' for auto
);

CREATE INDEX IF NOT EXISTS idx_announcements_epoch ON announcements(epoch_id);
CREATE INDEX IF NOT EXISTS idx_announcements_posted ON announcements(posted_at DESC);

-- Add last_scoring_run tracking if not exists
CREATE TABLE IF NOT EXISTS system_status (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize scoring status
INSERT INTO system_status (key, value) 
VALUES ('last_scoring_run', '{"timestamp": null, "duration_ms": null, "posts_scored": 0, "posts_filtered": 0}')
ON CONFLICT (key) DO NOTHING;
```

### 1.2 Admin Auth Helper

**File: `src/auth/admin.ts`**

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from './session';
import { logger } from '../logger';

/**
 * Check if a DID is in the admin list
 */
export function isAdmin(did: string): boolean {
  const adminDids = process.env.BOT_ADMIN_DIDS?.split(',').map(d => d.trim()).filter(Boolean) || [];
  return adminDids.includes(did);
}

/**
 * Get the current user's DID from session, or null if not logged in
 */
export function getCurrentUserDid(request: FastifyRequest): string | null {
  const session = getSession(request);
  return session?.did || null;
}

/**
 * Fastify preHandler hook that requires admin access
 * Returns 401 if not logged in, 403 if not admin
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const did = getCurrentUserDid(request);
  
  if (!did) {
    logger.warn({ path: request.url }, 'Admin access attempted without login');
    return reply.status(401).send({ error: 'Authentication required' });
  }
  
  if (!isAdmin(did)) {
    logger.warn({ did, path: request.url }, 'Admin access attempted by non-admin');
    return reply.status(403).send({ error: 'Admin access required' });
  }
  
  // Attach admin DID to request for later use
  (request as any).adminDid = did;
}

/**
 * Get admin DID from request (after requireAdmin has run)
 */
export function getAdminDid(request: FastifyRequest): string {
  return (request as any).adminDid;
}
```

### 1.3 Update Scoring Pipeline to Track Status

**File: `src/scoring/pipeline.ts`** (add at end of scoring run)

```typescript
// Add this import
import { updateScoringStatus } from '../admin/status-tracker';

// At the end of the scoring pipeline function, after scoring completes:
await updateScoringStatus({
  timestamp: new Date().toISOString(),
  duration_ms: elapsed,
  posts_scored: postsScored,
  posts_filtered: postsFiltered
});
```

**File: `src/admin/status-tracker.ts`** (new file)

```typescript
import { getDb } from '../db';

interface ScoringStatus {
  timestamp: string | null;
  duration_ms: number | null;
  posts_scored: number;
  posts_filtered: number;
}

export async function updateScoringStatus(status: ScoringStatus): Promise<void> {
  const db = getDb();
  await db.query(`
    INSERT INTO system_status (key, value, updated_at)
    VALUES ('last_scoring_run', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
  `, [JSON.stringify(status)]);
}

export async function getScoringStatus(): Promise<ScoringStatus> {
  const db = getDb();
  const result = await db.query(`
    SELECT value FROM system_status WHERE key = 'last_scoring_run'
  `);
  
  if (result.rows.length === 0) {
    return { timestamp: null, duration_ms: null, posts_scored: 0, posts_filtered: 0 };
  }
  
  return result.rows[0].value as ScoringStatus;
}
```

### Phase 1 Testing

```bash
# 1. Run migration
npm run migrate

# 2. Verify columns added
psql -c "\d governance_epochs" | grep -E "voting_ends_at|auto_transition"

# 3. Verify announcements table
psql -c "\d announcements"

# 4. Verify system_status table
psql -c "SELECT * FROM system_status"

# 5. Test isAdmin function manually
# In a test file or REPL:
# isAdmin('did:plc:your-admin-did') should return true
# isAdmin('did:plc:random-did') should return false

# 6. Verify BOT_ADMIN_DIDS is set in .env
grep BOT_ADMIN_DIDS .env
```

**Checkpoint:** All database changes applied, auth helper compiles, scoring status tracking works.

---

## Phase 2: Core Admin API Endpoints

### 2.1 Admin Routes Index

**File: `src/admin/routes/index.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../auth/admin';
import { registerStatusRoutes } from './status';
import { registerEpochRoutes } from './epochs';
import { registerAnnouncementRoutes } from './announcements';
import { registerFeedHealthRoutes } from './feed-health';
import { registerAuditLogRoutes } from './audit-log';

export function registerAdminRoutes(app: FastifyInstance) {
  // Create admin sub-app with auth requirement
  app.register(async (adminApp) => {
    // All admin routes require admin auth
    adminApp.addHook('preHandler', requireAdmin);
    
    registerStatusRoutes(adminApp);
    registerEpochRoutes(adminApp);
    registerAnnouncementRoutes(adminApp);
    registerFeedHealthRoutes(adminApp);
    registerAuditLogRoutes(adminApp);
  }, { prefix: '/api/admin' });
}
```

### 2.2 Status Endpoint

**File: `src/admin/routes/status.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { getDb } from '../../db';
import { getScoringStatus } from '../status-tracker';
import { getCurrentContentRules } from '../../governance/content-filter';

export function registerStatusRoutes(app: FastifyInstance) {
  /**
   * GET /api/admin/status
   * Returns admin status check and system overview
   */
  app.get('/status', async (request, reply) => {
    const db = getDb();
    
    // Get current epoch
    const epochResult = await db.query(`
      SELECT 
        id,
        status,
        voting_open,
        voting_ends_at,
        auto_transition,
        weights,
        content_rules,
        created_at
      FROM governance_epochs 
      WHERE status = 'active' 
      ORDER BY id DESC 
      LIMIT 1
    `);
    
    const currentEpoch = epochResult.rows[0] || null;
    
    // Get vote count for current epoch
    let voteCount = 0;
    if (currentEpoch) {
      const voteResult = await db.query(`
        SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1
      `, [currentEpoch.id]);
      voteCount = parseInt(voteResult.rows[0].count, 10);
    }
    
    // Get feed stats
    const feedStats = await db.query(`
      SELECT 
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as posts_24h
      FROM posts
    `);
    
    // Get subscriber count
    const subResult = await db.query(`
      SELECT COUNT(DISTINCT did) as count FROM subscribers WHERE subscribed = true
    `);
    
    // Get scoring status
    const scoringStatus = await getScoringStatus();
    
    // Get content rules
    const contentRules = await getCurrentContentRules();
    
    return {
      isAdmin: true,
      system: {
        currentEpoch: currentEpoch ? {
          id: currentEpoch.id,
          status: currentEpoch.status,
          votingOpen: currentEpoch.voting_open,
          votingEndsAt: currentEpoch.voting_ends_at,
          autoTransition: currentEpoch.auto_transition,
          voteCount,
          weights: currentEpoch.weights,
          contentRules: currentEpoch.content_rules,
          createdAt: currentEpoch.created_at
        } : null,
        feed: {
          totalPosts: parseInt(feedStats.rows[0].total_posts, 10),
          postsLast24h: parseInt(feedStats.rows[0].posts_24h, 10),
          scoredPosts: scoringStatus.posts_scored,
          lastScoringRun: scoringStatus.timestamp,
          lastScoringDuration: scoringStatus.duration_ms,
          subscriberCount: parseInt(subResult.rows[0].count, 10)
        },
        contentRules: {
          includeKeywords: contentRules.includeKeywords,
          excludeKeywords: contentRules.excludeKeywords
        }
      }
    };
  });
}
```

### 2.3 Epoch Management Endpoints

**File: `src/admin/routes/epochs.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db';
import { getAdminDid } from '../../auth/admin';
import { logAuditEvent } from '../../governance/audit';
import { closeCurrentEpochAndCreateNext } from '../../governance/epoch-manager';
import { postAnnouncement } from '../../bot/announcements';
import { logger } from '../../logger';

const UpdateEpochSchema = z.object({
  votingOpen: z.boolean().optional(),
  votingEndsAt: z.string().datetime().nullable().optional(),
  autoTransition: z.boolean().optional()
});

const TransitionSchema = z.object({
  force: z.boolean().optional().default(false),
  announceResults: z.boolean().optional().default(true)
});

export function registerEpochRoutes(app: FastifyInstance) {
  /**
   * GET /api/admin/epochs
   * List all epochs with details
   */
  app.get('/epochs', async (request, reply) => {
    const db = getDb();
    
    const result = await db.query(`
      SELECT 
        e.id,
        e.status,
        e.voting_open,
        e.voting_ends_at,
        e.auto_transition,
        e.weights,
        e.content_rules,
        e.created_at,
        e.ended_at,
        COUNT(v.id) as vote_count
      FROM governance_epochs e
      LEFT JOIN governance_votes v ON v.epoch_id = e.id
      GROUP BY e.id
      ORDER BY e.id DESC
      LIMIT 20
    `);
    
    return {
      epochs: result.rows.map(row => ({
        id: row.id,
        status: row.status,
        votingOpen: row.voting_open,
        votingEndsAt: row.voting_ends_at,
        autoTransition: row.auto_transition,
        weights: row.weights,
        contentRules: row.content_rules,
        voteCount: parseInt(row.vote_count, 10),
        createdAt: row.created_at,
        endedAt: row.ended_at
      }))
    };
  });

  /**
   * PATCH /api/admin/epochs/current
   * Update current epoch settings
   */
  app.patch('/epochs/current', async (request, reply) => {
    const adminDid = getAdminDid(request);
    const body = UpdateEpochSchema.parse(request.body);
    const db = getDb();
    
    // Get current epoch
    const current = await db.query(`
      SELECT id, voting_open FROM governance_epochs WHERE status = 'active' LIMIT 1
    `);
    
    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }
    
    const epochId = current.rows[0].id;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (body.votingOpen !== undefined) {
      updates.push(`voting_open = $${paramIndex++}`);
      values.push(body.votingOpen);
    }
    
    if (body.votingEndsAt !== undefined) {
      // Validate future date if setting
      if (body.votingEndsAt && new Date(body.votingEndsAt) <= new Date()) {
        return reply.status(400).send({ error: 'Voting end date must be in the future' });
      }
      updates.push(`voting_ends_at = $${paramIndex++}`);
      values.push(body.votingEndsAt);
    }
    
    if (body.autoTransition !== undefined) {
      updates.push(`auto_transition = $${paramIndex++}`);
      values.push(body.autoTransition);
    }
    
    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No updates provided' });
    }
    
    values.push(epochId);
    
    const result = await db.query(`
      UPDATE governance_epochs 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);
    
    // Log to audit
    await logAuditEvent({
      action: 'epoch_updated',
      actor: adminDid,
      details: { epochId, updates: body }
    });
    
    logger.info({ epochId, updates: body, adminDid }, 'Epoch updated by admin');
    
    return {
      success: true,
      epoch: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        votingOpen: result.rows[0].voting_open,
        votingEndsAt: result.rows[0].voting_ends_at,
        autoTransition: result.rows[0].auto_transition
      }
    };
  });

  /**
   * POST /api/admin/epochs/transition
   * Manually trigger epoch transition
   */
  app.post('/epochs/transition', async (request, reply) => {
    const adminDid = getAdminDid(request);
    const body = TransitionSchema.parse(request.body || {});
    const db = getDb();
    
    // Get current epoch info before transition
    const current = await db.query(`
      SELECT id, weights, content_rules,
        (SELECT COUNT(*) FROM governance_votes WHERE epoch_id = governance_epochs.id) as vote_count
      FROM governance_epochs 
      WHERE status = 'active' 
      LIMIT 1
    `);
    
    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }
    
    const previousEpoch = current.rows[0];
    const voteCount = parseInt(previousEpoch.vote_count, 10);
    
    // Check minimum votes unless forcing
    const minVotes = parseInt(process.env.MIN_VOTES_FOR_TRANSITION || '5', 10);
    if (!body.force && voteCount < minVotes) {
      return reply.status(400).send({ 
        error: `Insufficient votes for transition. Need ${minVotes}, have ${voteCount}. Use force=true to override.`
      });
    }
    
    try {
      // Perform transition
      const newEpochId = await closeCurrentEpochAndCreateNext();
      
      // Log to audit
      await logAuditEvent({
        action: 'epoch_transition',
        actor: adminDid,
        details: { 
          fromEpoch: previousEpoch.id, 
          toEpoch: newEpochId, 
          forced: body.force,
          voteCount 
        }
      });
      
      logger.info({ 
        fromEpoch: previousEpoch.id, 
        toEpoch: newEpochId, 
        forced: body.force,
        adminDid 
      }, 'Epoch transition triggered by admin');
      
      // Post announcement if requested
      let announcement = null;
      if (body.announceResults) {
        try {
          announcement = await postAnnouncement({
            type: 'epoch_end',
            epochId: previousEpoch.id,
            newEpochId,
            voteCount
          });
        } catch (err) {
          logger.error({ err }, 'Failed to post transition announcement');
        }
      }
      
      // Get new epoch data
      const newEpoch = await db.query(`
        SELECT * FROM governance_epochs WHERE id = $1
      `, [newEpochId]);
      
      return {
        success: true,
        previousEpoch: {
          id: previousEpoch.id,
          finalWeights: previousEpoch.weights,
          finalContentRules: previousEpoch.content_rules,
          totalVotes: voteCount
        },
        newEpoch: {
          id: newEpochId,
          status: newEpoch.rows[0].status,
          votingOpen: newEpoch.rows[0].voting_open
        },
        announcement
      };
    } catch (err) {
      logger.error({ err }, 'Epoch transition failed');
      return reply.status(500).send({ error: 'Epoch transition failed' });
    }
  });

  /**
   * POST /api/admin/epochs/close-voting
   * Close voting without transitioning epoch
   */
  app.post('/epochs/close-voting', async (request, reply) => {
    const adminDid = getAdminDid(request);
    const db = getDb();
    
    const result = await db.query(`
      UPDATE governance_epochs 
      SET voting_open = false
      WHERE status = 'active'
      RETURNING id, voting_open
    `);
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }
    
    await logAuditEvent({
      action: 'voting_closed',
      actor: adminDid,
      details: { epochId: result.rows[0].id }
    });
    
    logger.info({ epochId: result.rows[0].id, adminDid }, 'Voting closed by admin');
    
    return {
      success: true,
      epoch: {
        id: result.rows[0].id,
        votingOpen: false
      }
    };
  });

  /**
   * POST /api/admin/epochs/open-voting
   * Reopen voting on current epoch
   */
  app.post('/epochs/open-voting', async (request, reply) => {
    const adminDid = getAdminDid(request);
    const db = getDb();
    
    const result = await db.query(`
      UPDATE governance_epochs 
      SET voting_open = true
      WHERE status = 'active'
      RETURNING id, voting_open
    `);
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }
    
    await logAuditEvent({
      action: 'voting_opened',
      actor: adminDid,
      details: { epochId: result.rows[0].id }
    });
    
    logger.info({ epochId: result.rows[0].id, adminDid }, 'Voting opened by admin');
    
    return {
      success: true,
      epoch: {
        id: result.rows[0].id,
        votingOpen: true
      }
    };
  });
}
```

### 2.4 Register Admin Routes in Main App

**File: `src/index.ts`** (or main server file - add import and registration)

```typescript
// Add import near top
import { registerAdminRoutes } from './admin/routes';

// Add after other route registrations
registerAdminRoutes(app);
```

### Phase 2 Testing

```bash
# 1. Build and start server
npm run build && npm run dev

# 2. Test status endpoint (should fail without auth)
curl http://localhost:3001/api/admin/status
# Expected: {"error":"Authentication required"}

# 3. Test with your session cookie (get from browser dev tools)
curl -H "Cookie: session=YOUR_SESSION_COOKIE" http://localhost:3001/api/admin/status
# Expected: Full status JSON with isAdmin: true

# 4. Test epochs list
curl -H "Cookie: session=YOUR_SESSION_COOKIE" http://localhost:3001/api/admin/epochs

# 5. Test epoch update (set voting end date)
curl -X PATCH http://localhost:3001/api/admin/epochs/current \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"votingEndsAt": "2025-02-10T00:00:00Z", "autoTransition": true}'

# 6. Test close voting
curl -X POST http://localhost:3001/api/admin/epochs/close-voting \
  -H "Cookie: session=YOUR_SESSION_COOKIE"

# 7. Test open voting
curl -X POST http://localhost:3001/api/admin/epochs/open-voting \
  -H "Cookie: session=YOUR_SESSION_COOKIE"

# 8. Verify audit log recorded actions
psql -c "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 5"
```

**Checkpoint:** All epoch management endpoints working, auth required, actions logged.

---

## Phase 3: Announcement & Health Endpoints

### 3.1 Announcement Endpoints

**File: `src/admin/routes/announcements.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db';
import { getAdminDid } from '../../auth/admin';
import { logAuditEvent } from '../../governance/audit';
import { postCustomAnnouncement } from '../../bot/announcements';
import { logger } from '../../logger';

const PostAnnouncementSchema = z.object({
  content: z.string().min(1).max(280),
  includeEpochLink: z.boolean().optional().default(true)
});

export function registerAnnouncementRoutes(app: FastifyInstance) {
  /**
   * GET /api/admin/announcements
   * List recent announcements
   */
  app.get('/announcements', async (request, reply) => {
    const db = getDb();
    
    const result = await db.query(`
      SELECT 
        id,
        epoch_id,
        content,
        post_uri,
        announcement_type,
        posted_at,
        posted_by
      FROM announcements
      ORDER BY posted_at DESC
      LIMIT 20
    `);
    
    return {
      announcements: result.rows.map(row => ({
        id: row.id,
        epochId: row.epoch_id,
        content: row.content,
        postUri: row.post_uri,
        postUrl: uriToUrl(row.post_uri),
        type: row.announcement_type,
        postedAt: row.posted_at,
        postedBy: row.posted_by
      }))
    };
  });

  /**
   * POST /api/admin/announcements
   * Post a custom announcement
   */
  app.post('/announcements', async (request, reply) => {
    const adminDid = getAdminDid(request);
    const body = PostAnnouncementSchema.parse(request.body);
    const db = getDb();
    
    // Rate limit: check last announcement time
    const recent = await db.query(`
      SELECT posted_at FROM announcements 
      WHERE posted_by = $1 
      ORDER BY posted_at DESC 
      LIMIT 1
    `, [adminDid]);
    
    if (recent.rows.length > 0) {
      const lastPosted = new Date(recent.rows[0].posted_at);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (lastPosted > fiveMinutesAgo) {
        const waitSeconds = Math.ceil((lastPosted.getTime() - fiveMinutesAgo.getTime()) / 1000);
        return reply.status(429).send({ 
          error: `Rate limited. Please wait ${waitSeconds} seconds before posting another announcement.`
        });
      }
    }
    
    try {
      // Get current epoch for link
      const epochResult = await db.query(`
        SELECT id FROM governance_epochs WHERE status = 'active' LIMIT 1
      `);
      const epochId = epochResult.rows[0]?.id || null;
      
      // Post to Bluesky
      const result = await postCustomAnnouncement({
        content: body.content,
        includeLink: body.includeEpochLink
      });
      
      // Store in database
      await db.query(`
        INSERT INTO announcements (epoch_id, post_uri, post_cid, content, announcement_type, posted_by)
        VALUES ($1, $2, $3, $4, 'custom', $5)
      `, [epochId, result.uri, result.cid, body.content, adminDid]);
      
      // Log to audit
      await logAuditEvent({
        action: 'announcement_posted',
        actor: adminDid,
        details: { content: body.content, postUri: result.uri }
      });
      
      logger.info({ postUri: result.uri, adminDid }, 'Custom announcement posted');
      
      return {
        success: true,
        announcement: {
          postUri: result.uri,
          postUrl: uriToUrl(result.uri)
        }
      };
    } catch (err) {
      logger.error({ err }, 'Failed to post announcement');
      return reply.status(500).send({ error: 'Failed to post announcement to Bluesky' });
    }
  });
}

/**
 * Convert AT URI to Bluesky web URL
 */
function uriToUrl(uri: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/yyy -> https://bsky.app/profile/did:plc:xxx/post/yyy
  const match = uri.match(/at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)/);
  if (match) {
    return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
  }
  return uri;
}
```

### 3.2 Update Bot Announcements Module

**File: `src/bot/announcements.ts`** (add or update)

```typescript
// Add this function if it doesn't exist

interface CustomAnnouncementParams {
  content: string;
  includeLink?: boolean;
}

export async function postCustomAnnouncement(params: CustomAnnouncementParams): Promise<{ uri: string; cid: string }> {
  const agent = await getBotAgent();
  
  let text = params.content;
  
  // Append link if requested
  if (params.includeLink) {
    const voteUrl = process.env.PUBLIC_URL || 'https://feed.corgi.network';
    text += `\n\n🗳️ Vote: ${voteUrl}/vote`;
  }
  
  const result = await agent.post({
    text,
    createdAt: new Date().toISOString()
  });
  
  return {
    uri: result.uri,
    cid: result.cid
  };
}
```

### 3.3 Feed Health Endpoint

**File: `src/admin/routes/feed-health.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { getDb } from '../../db';
import { getScoringStatus } from '../status-tracker';
import { getRedis } from '../../redis';
import { getAdminDid } from '../../auth/admin';
import { logAuditEvent } from '../../governance/audit';
import { runScoringPipeline } from '../../scoring/pipeline';
import { logger } from '../../logger';

export function registerFeedHealthRoutes(app: FastifyInstance) {
  /**
   * GET /api/admin/feed-health
   * Detailed feed statistics
   */
  app.get('/feed-health', async (request, reply) => {
    const db = getDb();
    const redis = getRedis();
    
    // Database stats
    const dbStats = await db.query(`
      SELECT 
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as posts_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as posts_7d,
        MIN(created_at) as oldest_post,
        MAX(created_at) as newest_post
      FROM posts
    `);
    
    // Scoring status
    const scoringStatus = await getScoringStatus();
    
    // Jetstream status (check Redis for last event)
    let jetstreamStatus = { connected: false, lastEvent: null, eventsLast5min: 0 };
    try {
      const lastEvent = await redis.get('jetstream:last_event');
      const eventCount = await redis.get('jetstream:event_count_5min');
      
      if (lastEvent) {
        const lastEventTime = new Date(lastEvent);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        jetstreamStatus = {
          connected: lastEventTime > fiveMinutesAgo,
          lastEvent,
          eventsLast5min: parseInt(eventCount || '0', 10)
        };
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to get Jetstream status from Redis');
    }
    
    // Subscriber stats
    const subStats = await db.query(`
      SELECT 
        COUNT(DISTINCT did) as total,
        COUNT(DISTINCT did) FILTER (
          WHERE did IN (SELECT DISTINCT did FROM governance_votes)
        ) as with_votes,
        COUNT(DISTINCT did) FILTER (
          WHERE subscribed_at > NOW() - INTERVAL '7 days'
        ) as active_week
      FROM subscribers
      WHERE subscribed = true
    `);
    
    // Content rules
    const epochResult = await db.query(`
      SELECT content_rules, created_at as rules_updated
      FROM governance_epochs 
      WHERE status = 'active' 
      LIMIT 1
    `);
    
    const contentRules = epochResult.rows[0]?.content_rules || { include_keywords: [], exclude_keywords: [] };
    
    return {
      database: {
        totalPosts: parseInt(dbStats.rows[0].total_posts, 10),
        postsLast24h: parseInt(dbStats.rows[0].posts_24h, 10),
        postsLast7d: parseInt(dbStats.rows[0].posts_7d, 10),
        oldestPost: dbStats.rows[0].oldest_post,
        newestPost: dbStats.rows[0].newest_post
      },
      scoring: {
        lastRun: scoringStatus.timestamp,
        lastRunDuration: scoringStatus.duration_ms,
        postsScored: scoringStatus.posts_scored,
        postsFiltered: scoringStatus.posts_filtered
      },
      jetstream: jetstreamStatus,
      subscribers: {
        total: parseInt(subStats.rows[0].total, 10),
        withVotes: parseInt(subStats.rows[0].with_votes, 10),
        activeLastWeek: parseInt(subStats.rows[0].active_week, 10)
      },
      contentRules: {
        includeKeywords: contentRules.include_keywords || [],
        excludeKeywords: contentRules.exclude_keywords || [],
        lastUpdated: epochResult.rows[0]?.rules_updated
      }
    };
  });

  /**
   * POST /api/admin/feed/rescore
   * Manually trigger scoring pipeline
   */
  app.post('/feed/rescore', async (request, reply) => {
    const adminDid = getAdminDid(request);
    
    // Log to audit
    await logAuditEvent({
      action: 'manual_rescore',
      actor: adminDid,
      details: {}
    });
    
    logger.info({ adminDid }, 'Manual rescore triggered by admin');
    
    // Run scoring asynchronously
    runScoringPipeline().catch(err => {
      logger.error({ err }, 'Manual rescore failed');
    });
    
    return {
      success: true,
      message: 'Scoring pipeline started. Check feed-health endpoint for results.'
    };
  });
}
```

### 3.4 Audit Log Endpoint

**File: `src/admin/routes/audit-log.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { getDb } from '../../db';

export function registerAuditLogRoutes(app: FastifyInstance) {
  /**
   * GET /api/admin/audit-log
   * View recent admin/system actions
   */
  app.get('/audit-log', async (request, reply) => {
    const query = request.query as { limit?: string; action?: string; actor?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const db = getDb();
    
    let sql = `
      SELECT id, action, actor, details, created_at
      FROM audit_log
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (query.action) {
      sql += ` AND action = $${paramIndex++}`;
      params.push(query.action);
    }
    
    if (query.actor) {
      sql += ` AND actor = $${paramIndex++}`;
      params.push(query.actor);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);
    
    const result = await db.query(sql, params);
    
    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM audit_log WHERE 1=1';
    const countParams: any[] = [];
    let countIndex = 1;
    
    if (query.action) {
      countSql += ` AND action = $${countIndex++}`;
      countParams.push(query.action);
    }
    if (query.actor) {
      countSql += ` AND actor = $${countIndex++}`;
      countParams.push(query.actor);
    }
    
    const countResult = await db.query(countSql, countParams);
    
    return {
      entries: result.rows.map(row => ({
        id: row.id,
        action: row.action,
        actor: row.actor,
        details: row.details,
        timestamp: row.created_at
      })),
      total: parseInt(countResult.rows[0].total, 10)
    };
  });
}
```

### Phase 3 Testing

```bash
# 1. Test announcements list
curl -H "Cookie: session=YOUR_SESSION" http://localhost:3001/api/admin/announcements

# 2. Test posting announcement
curl -X POST http://localhost:3001/api/admin/announcements \
  -H "Cookie: session=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"content": "📢 Test announcement from admin dashboard!", "includeEpochLink": true}'

# 3. Verify announcement posted to Bluesky
# Check the URL returned in the response

# 4. Test rate limiting (post again immediately)
# Should get 429 error

# 5. Test feed health
curl -H "Cookie: session=YOUR_SESSION" http://localhost:3001/api/admin/feed-health

# 6. Test manual rescore
curl -X POST http://localhost:3001/api/admin/feed/rescore \
  -H "Cookie: session=YOUR_SESSION"

# 7. Wait a few seconds, then check feed-health again for updated scoring stats

# 8. Test audit log
curl -H "Cookie: session=YOUR_SESSION" http://localhost:3001/api/admin/audit-log

# 9. Test audit log with filters
curl -H "Cookie: session=YOUR_SESSION" "http://localhost:3001/api/admin/audit-log?action=announcement_posted&limit=10"
```

**Checkpoint:** All endpoints working, announcements post to Bluesky, audit log captures all actions.

---

## Phase 4: Epoch Scheduler

### 4.1 Scheduler Implementation

**File: `src/scheduler/epoch-scheduler.ts`**

```typescript
import cron from 'node-cron';
import { getDb } from '../db';
import { closeCurrentEpochAndCreateNext } from '../governance/epoch-manager';
import { postAnnouncement } from '../bot/announcements';
import { logAuditEvent } from '../governance/audit';
import { logger } from '../logger';

let schedulerTask: cron.ScheduledTask | null = null;

/**
 * Start the epoch scheduler
 * Runs every hour to check for epochs that need auto-transition
 */
export function startEpochScheduler() {
  if (schedulerTask) {
    logger.warn('Epoch scheduler already running');
    return;
  }
  
  // Run at minute 0 of every hour
  schedulerTask = cron.schedule('0 * * * *', async () => {
    logger.info('Epoch scheduler running');
    await checkScheduledTransitions();
  });
  
  logger.info('Epoch scheduler started (runs every hour at :00)');
  
  // Also run immediately on startup to catch any missed transitions
  checkScheduledTransitions().catch(err => {
    logger.error({ err }, 'Initial scheduler check failed');
  });
}

/**
 * Stop the epoch scheduler
 */
export function stopEpochScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Epoch scheduler stopped');
  }
}

/**
 * Check for epochs that need auto-transition
 */
async function checkScheduledTransitions() {
  const db = getDb();
  
  try {
    // Find epochs where voting has ended and auto_transition is enabled
    const result = await db.query(`
      SELECT id, voting_ends_at 
      FROM governance_epochs 
      WHERE status = 'active' 
        AND voting_ends_at IS NOT NULL 
        AND voting_ends_at <= NOW()
        AND auto_transition = true
        AND voting_open = true
    `);
    
    if (result.rows.length === 0) {
      logger.debug('No epochs ready for auto-transition');
      return;
    }
    
    for (const epoch of result.rows) {
      logger.info({ epochId: epoch.id, votingEndsAt: epoch.voting_ends_at }, 'Auto-transitioning epoch');
      
      try {
        // Close voting first
        await db.query(`
          UPDATE governance_epochs SET voting_open = false WHERE id = $1
        `, [epoch.id]);
        
        // Get vote count
        const voteResult = await db.query(`
          SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1
        `, [epoch.id]);
        const voteCount = parseInt(voteResult.rows[0].count, 10);
        
        // Transition to new epoch
        const newEpochId = await closeCurrentEpochAndCreateNext();
        
        // Log to audit
        await logAuditEvent({
          action: 'auto_epoch_transition',
          actor: 'system',
          details: { 
            fromEpoch: epoch.id, 
            toEpoch: newEpochId, 
            trigger: 'scheduled',
            votingEndsAt: epoch.voting_ends_at,
            voteCount
          }
        });
        
        // Post announcement
        try {
          await postAnnouncement({
            type: 'epoch_end',
            epochId: epoch.id,
            newEpochId,
            voteCount
          });
        } catch (err) {
          logger.error({ err }, 'Failed to post auto-transition announcement');
        }
        
        logger.info({ fromEpoch: epoch.id, toEpoch: newEpochId }, 'Auto-transition completed');
        
      } catch (err) {
        logger.error({ epochId: epoch.id, err }, 'Auto-transition failed for epoch');
        
        // Log failure to audit
        await logAuditEvent({
          action: 'auto_epoch_transition_failed',
          actor: 'system',
          details: { epochId: epoch.id, error: String(err) }
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler check failed');
  }
}

/**
 * Manually trigger a scheduler check (for testing)
 */
export async function runSchedulerCheck() {
  await checkScheduledTransitions();
}
```

### 4.2 Add Scheduler to Server Startup

**File: `src/index.ts`** (add to startup)

```typescript
// Add import
import { startEpochScheduler } from './scheduler/epoch-scheduler';

// Add after server starts listening
startEpochScheduler();
```

### 4.3 Add node-cron dependency

```bash
npm install node-cron
npm install -D @types/node-cron
```

### Phase 4 Testing

```bash
# 1. Set an epoch to auto-transition in 2 minutes
curl -X PATCH http://localhost:3001/api/admin/epochs/current \
  -H "Cookie: session=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d "{\"votingEndsAt\": \"$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)\", \"autoTransition\": true}"

# 2. Check current epoch
curl -H "Cookie: session=YOUR_SESSION" http://localhost:3001/api/admin/status | jq '.system.currentEpoch'

# 3. Wait for the scheduler to run (happens at :00 of each hour, or restart server)
# Or manually trigger via API if you add a debug endpoint

# 4. Check audit log for auto_epoch_transition
psql -c "SELECT * FROM audit_log WHERE action = 'auto_epoch_transition' ORDER BY created_at DESC LIMIT 1"

# 5. Verify new epoch created
curl -H "Cookie: session=YOUR_SESSION" http://localhost:3001/api/admin/epochs

# 6. Check Bluesky for auto-transition announcement
```

**Checkpoint:** Scheduler runs, auto-transitions work, announcements post automatically.

---

## Phase 5: Frontend - Layout & Auth

### 5.1 Admin API Client

**File: `web/src/api/admin.ts`**

```typescript
const API_BASE = '/api/admin';

// Types
export interface AdminStatus {
  isAdmin: boolean;
  system: {
    currentEpoch: {
      id: number;
      status: string;
      votingOpen: boolean;
      votingEndsAt: string | null;
      autoTransition: boolean;
      voteCount: number;
      weights: Record<string, number>;
      contentRules: { include_keywords: string[]; exclude_keywords: string[] };
      createdAt: string;
    } | null;
    feed: {
      totalPosts: number;
      postsLast24h: number;
      scoredPosts: number;
      lastScoringRun: string | null;
      lastScoringDuration: number | null;
      subscriberCount: number;
    };
    contentRules: {
      includeKeywords: string[];
      excludeKeywords: string[];
    };
  };
}

export interface Epoch {
  id: number;
  status: string;
  votingOpen: boolean;
  votingEndsAt: string | null;
  autoTransition: boolean;
  weights: Record<string, number>;
  contentRules: { include_keywords: string[]; exclude_keywords: string[] };
  voteCount: number;
  createdAt: string;
  endedAt: string | null;
}

export interface Announcement {
  id: number;
  epochId: number | null;
  content: string;
  postUri: string;
  postUrl: string;
  type: string;
  postedAt: string;
  postedBy: string;
}

export interface FeedHealth {
  database: {
    totalPosts: number;
    postsLast24h: number;
    postsLast7d: number;
    oldestPost: string;
    newestPost: string;
  };
  scoring: {
    lastRun: string | null;
    lastRunDuration: number | null;
    postsScored: number;
    postsFiltered: number;
  };
  jetstream: {
    connected: boolean;
    lastEvent: string | null;
    eventsLast5min: number;
  };
  subscribers: {
    total: number;
    withVotes: number;
    activeLastWeek: number;
  };
  contentRules: {
    includeKeywords: string[];
    excludeKeywords: string[];
    lastUpdated: string | null;
  };
}

export interface AuditEntry {
  id: number;
  action: string;
  actor: string;
  details: Record<string, any>;
  timestamp: string;
}

// API Functions
export const adminApi = {
  async getStatus(): Promise<AdminStatus> {
    const res = await fetch(`${API_BASE}/status`, { credentials: 'include' });
    if (res.status === 401) throw new Error('Not authenticated');
    if (res.status === 403) throw new Error('Not authorized');
    if (!res.ok) throw new Error('Failed to fetch admin status');
    return res.json();
  },

  async getEpochs(): Promise<{ epochs: Epoch[] }> {
    const res = await fetch(`${API_BASE}/epochs`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch epochs');
    return res.json();
  },

  async updateEpoch(data: { 
    votingOpen?: boolean; 
    votingEndsAt?: string | null; 
    autoTransition?: boolean 
  }): Promise<{ success: boolean; epoch: Partial<Epoch> }> {
    const res = await fetch(`${API_BASE}/epochs/current`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update epoch');
    }
    return res.json();
  },

  async transitionEpoch(options: { force?: boolean; announceResults?: boolean } = {}): Promise<{
    success: boolean;
    previousEpoch: { id: number; totalVotes: number };
    newEpoch: { id: number };
    announcement: { postUrl: string } | null;
  }> {
    const res = await fetch(`${API_BASE}/epochs/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(options)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to transition epoch');
    }
    return res.json();
  },

  async closeVoting(): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/epochs/close-voting`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to close voting');
    return res.json();
  },

  async openVoting(): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/epochs/open-voting`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to open voting');
    return res.json();
  },

  async getAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const res = await fetch(`${API_BASE}/announcements`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch announcements');
    return res.json();
  },

  async postAnnouncement(data: { content: string; includeEpochLink?: boolean }): Promise<{
    success: boolean;
    announcement: { postUri: string; postUrl: string };
  }> {
    const res = await fetch(`${API_BASE}/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to post announcement');
    }
    return res.json();
  },

  async getFeedHealth(): Promise<FeedHealth> {
    const res = await fetch(`${API_BASE}/feed-health`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch feed health');
    return res.json();
  },

  async triggerRescore(): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/feed/rescore`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to trigger rescore');
    return res.json();
  },

  async getAuditLog(params: { action?: string; limit?: number } = {}): Promise<{
    entries: AuditEntry[];
    total: number;
  }> {
    const query = new URLSearchParams();
    if (params.action) query.set('action', params.action);
    if (params.limit) query.set('limit', String(params.limit));
    
    const res = await fetch(`${API_BASE}/audit-log?${query}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch audit log');
    return res.json();
  }
};
```

### 5.2 Admin Status Hook

**File: `web/src/hooks/useAdminStatus.ts`**

```typescript
import { useState, useEffect } from 'react';
import { adminApi, AdminStatus } from '../api/admin';

export function useAdminStatus() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    try {
      setIsLoading(true);
      const data = await adminApi.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  return {
    status,
    isAdmin: status?.isAdmin ?? false,
    isLoading,
    error,
    refetch: fetchStatus
  };
}
```

### 5.3 Admin Guard Component

**File: `web/src/components/admin/AdminGuard.tsx`**

```typescript
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useAdminStatus } from '../../hooks/useAdminStatus';

interface AdminGuardProps {
  children: ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading, error } = useAdminStatus();

  // Show loading state
  if (authLoading || adminLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner" />
        <p>Checking access...</p>
      </div>
    );
  }

  // Redirect if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Redirect if not admin
  if (!isAdmin || error) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
```

### 5.4 Admin Page Shell

**File: `web/src/pages/Admin.tsx`**

```typescript
import { useState } from 'react';
import { AdminGuard } from '../components/admin/AdminGuard';
import { OverviewPanel } from '../components/admin/OverviewPanel';
import { EpochManager } from '../components/admin/EpochManager';
import { AnnouncementPanel } from '../components/admin/AnnouncementPanel';
import { FeedHealth } from '../components/admin/FeedHealth';
import { AuditLog } from '../components/admin/AuditLog';
import '../styles/admin.css';

type AdminTab = 'overview' | 'epochs' | 'announcements' | 'health' | 'audit';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  return (
    <AdminGuard>
      <div className="admin-container">
        <header className="admin-header">
          <h1>Admin Dashboard</h1>
          <p className="admin-subtitle">Manage feed governance and monitor system health</p>
        </header>

        <nav className="admin-tabs">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'epochs', label: 'Epochs' },
            { id: 'announcements', label: 'Announcements' },
            { id: 'health', label: 'Feed Health' },
            { id: 'audit', label: 'Audit Log' }
          ].map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id as AdminTab)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="admin-content">
          {activeTab === 'overview' && <OverviewPanel onNavigate={setActiveTab} />}
          {activeTab === 'epochs' && <EpochManager />}
          {activeTab === 'announcements' && <AnnouncementPanel />}
          {activeTab === 'health' && <FeedHealth />}
          {activeTab === 'audit' && <AuditLog />}
        </main>
      </div>
    </AdminGuard>
  );
}
```

### 5.5 Add Route

**File: `web/src/App.tsx`** (add import and route)

```typescript
// Add import
import { AdminPage } from './pages/Admin';

// Add route inside Routes
<Route path="/admin" element={<AdminPage />} />
```

### 5.6 Add Nav Link for Admins

**File: `web/src/components/Nav.tsx`** (update)

```typescript
// Add import
import { useAdminStatus } from '../hooks/useAdminStatus';

// Inside component
const { isAdmin } = useAdminStatus();

// Add to nav links (only shows for admins)
{isAdmin && (
  <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
    Admin
  </NavLink>
)}
```

### 5.7 Base Admin Styles

**File: `web/src/styles/admin.css`**

```css
/* ========================================
   Admin Dashboard Styles
   Design matches Vote page styling exactly
   ======================================== */

/* Container */
.admin-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;
}

/* Header */
.admin-header {
  margin-bottom: 32px;
}

.admin-header h1 {
  font-size: 24px;
  font-weight: 600;
  color: #f1f3f5;
  margin: 0 0 8px 0;
}

.admin-subtitle {
  color: #787c7e;
  font-size: 14px;
  margin: 0;
}

/* Loading State */
.admin-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  color: #787c7e;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #2a2b2d;
  border-top-color: #1083fe;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Tabs - matches Vote page tab styling */
.admin-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 1px solid #2a2b2d;
  padding-bottom: 0;
}

.admin-tabs button {
  padding: 12px 20px;
  background: none;
  border: none;
  color: #787c7e;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.2s, border-color 0.2s;
}

.admin-tabs button:hover {
  color: #f1f3f5;
}

.admin-tabs button.active {
  color: #1083fe;
  border-bottom-color: #1083fe;
}

/* Content Area */
.admin-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Cards - matches Vote page cards */
.admin-card {
  background: #1e1f21;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
}

.admin-card h2 {
  font-size: 16px;
  font-weight: 600;
  color: #f1f3f5;
  margin: 0 0 20px 0;
}

.admin-card h3 {
  font-size: 14px;
  font-weight: 500;
  color: #787c7e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 12px 0;
}

/* Overview Grid */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

/* Stat Cards */
.stat-card {
  background: #1e1f21;
  border-radius: 12px;
  padding: 20px;
}

.stat-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.stat-card-header h3 {
  margin: 0;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: #f1f3f5;
  margin-bottom: 8px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #2a2b2d;
}

.stat-row:last-child {
  border-bottom: none;
}

.stat-row span {
  color: #787c7e;
  font-size: 14px;
}

.stat-row strong {
  color: #f1f3f5;
  font-size: 14px;
  font-weight: 500;
}

/* Status Badges */
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.open,
.status-badge.active {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.status-badge.closed,
.status-badge.completed {
  background: rgba(120, 124, 126, 0.15);
  color: #787c7e;
}

.status-badge.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Keyword Pills - matches Vote page pills */
.keyword-section {
  margin-bottom: 12px;
}

.keyword-section:last-child {
  margin-bottom: 0;
}

.keyword-section label {
  display: block;
  font-size: 12px;
  color: #787c7e;
  margin-bottom: 6px;
}

.keyword-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
}

.pill-include {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.pill-exclude {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.no-rules {
  color: #787c7e;
  font-size: 13px;
  font-style: italic;
}

/* Buttons - matches Vote page buttons */
.btn-primary {
  background: #1083fe;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #0969da;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #2a2b2d;
  color: #f1f3f5;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  background: #3a3b3d;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.btn-warning:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.25);
  border-color: rgba(245, 158, 11, 0.5);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
}

/* Button Groups */
.button-group {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.button-group-vertical {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Forms - matches Vote page form elements */
.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #f1f3f5;
  margin-bottom: 8px;
}

.form-group input[type="text"],
.form-group input[type="datetime-local"],
.form-group textarea,
.form-group select {
  width: 100%;
  background: #161718;
  border: 1px solid #2a2b2d;
  border-radius: 8px;
  padding: 12px 14px;
  color: #f1f3f5;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.2s;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #1083fe;
}

.form-group textarea {
  resize: vertical;
  min-height: 100px;
}

.form-group .help-text {
  font-size: 12px;
  color: #787c7e;
  margin-top: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
  color: #f1f3f5;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #1083fe;
}

/* Character Counter */
.char-count {
  text-align: right;
  font-size: 12px;
  color: #787c7e;
  margin-top: 6px;
}

.char-count.over-limit {
  color: #ef4444;
}

/* Tables */
.admin-table {
  width: 100%;
  border-collapse: collapse;
}

.admin-table th,
.admin-table td {
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2b2d;
}

.admin-table th {
  color: #787c7e;
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.admin-table td {
  color: #f1f3f5;
  font-size: 14px;
}

.admin-table tr.active-row {
  background: rgba(16, 131, 254, 0.05);
}

.admin-table tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

/* Connection Status */
.connection-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.status-indicator.connected {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}

.status-indicator.disconnected {
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.stat-item {
  text-align: center;
}

.stat-item .stat-label {
  font-size: 12px;
  color: #787c7e;
  margin-bottom: 4px;
}

.stat-item .stat-number {
  font-size: 24px;
  font-weight: 600;
  color: #f1f3f5;
}

/* Section Divider */
.section-divider {
  height: 1px;
  background: #2a2b2d;
  margin: 24px 0;
}

/* Alert Messages */
.alert {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 16px;
}

.alert-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.alert-error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.alert-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.alert-info {
  background: rgba(16, 131, 254, 0.15);
  color: #1083fe;
  border: 1px solid rgba(16, 131, 254, 0.3);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #787c7e;
}

.empty-state p {
  margin: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .admin-container {
    padding: 16px;
  }

  .admin-tabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .admin-tabs::-webkit-scrollbar {
    display: none;
  }

  .admin-tabs button {
    white-space: nowrap;
    padding: 12px 16px;
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .button-group {
    flex-direction: column;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

### Phase 5 Testing

```bash
# 1. Build frontend
cd web && npm run build

# 2. Start dev server
npm run dev

# 3. Navigate to /admin (as admin user)
# - Should see dashboard with tabs
# - Should see loading state briefly

# 4. Navigate to /admin (as non-admin user)
# - Should redirect to home

# 5. Navigate to /admin (not logged in)
# - Should redirect to home

# 6. Check responsive design
# - Resize browser, verify layout adapts

# 7. Verify Admin link appears in nav (only for admin)
```

**Checkpoint:** Admin page loads, auth guard works, styling matches Vote page.

---

## Phase 6: Frontend - Epoch & Scheduling Components

### 6.1 Overview Panel

**File: `web/src/components/admin/OverviewPanel.tsx`**

```typescript
import { useAdminStatus } from '../../hooks/useAdminStatus';
import { formatNumber, formatRelative } from '../../utils/format';

interface OverviewPanelProps {
  onNavigate: (tab: string) => void;
}

export function OverviewPanel({ onNavigate }: OverviewPanelProps) {
  const { status, isLoading, refetch } = useAdminStatus();

  if (isLoading || !status) {
    return <div className="admin-loading"><div className="loading-spinner" /></div>;
  }

  const { system } = status;
  const epoch = system.currentEpoch;

  return (
    <div className="overview-grid">
      {/* Current Epoch Card */}
      <div className="stat-card">
        <div className="stat-card-header">
          <h3>Current Epoch</h3>
          {epoch && (
            <span className={`status-badge ${epoch.votingOpen ? 'open' : 'closed'}`}>
              {epoch.votingOpen ? 'Voting Open' : 'Voting Closed'}
            </span>
          )}
        </div>
        {epoch ? (
          <>
            <div className="stat-value">Epoch {epoch.id}</div>
            <div className="stat-row">
              <span>Votes cast</span>
              <strong>{epoch.voteCount}</strong>
            </div>
            {epoch.votingEndsAt && (
              <div className="stat-row">
                <span>Voting ends</span>
                <strong>{formatRelative(epoch.votingEndsAt)}</strong>
              </div>
            )}
            <div className="stat-row">
              <span>Auto-transition</span>
              <strong>{epoch.autoTransition ? 'Enabled' : 'Disabled'}</strong>
            </div>
            <div className="button-group" style={{ marginTop: '16px' }}>
              <button className="btn-secondary" onClick={() => onNavigate('epochs')}>
                Manage
              </button>
            </div>
          </>
        ) : (
          <p className="empty-state">No active epoch</p>
        )}
      </div>

      {/* Feed Stats Card */}
      <div className="stat-card">
        <h3>Feed Status</h3>
        <div className="stat-row">
          <span>Posts in feed</span>
          <strong>{system.feed.scoredPosts}</strong>
        </div>
        <div className="stat-row">
          <span>Total indexed</span>
          <strong>{formatNumber(system.feed.totalPosts)}</strong>
        </div>
        <div className="stat-row">
          <span>Subscribers</span>
          <strong>{system.feed.subscriberCount}</strong>
        </div>
        <div className="stat-row">
          <span>Last scoring</span>
          <strong>{system.feed.lastScoringRun ? formatRelative(system.feed.lastScoringRun) : 'Never'}</strong>
        </div>
        <div className="button-group" style={{ marginTop: '16px' }}>
          <button className="btn-secondary" onClick={() => onNavigate('health')}>
            View Details
          </button>
        </div>
      </div>

      {/* Content Rules Card */}
      <div className="stat-card">
        <h3>Active Content Rules</h3>
        <div className="keyword-section">
          <label>Include keywords:</label>
          <div className="keyword-pills">
            {system.contentRules.includeKeywords.length > 0 ? (
              system.contentRules.includeKeywords.map(k => (
                <span key={k} className="pill pill-include">{k}</span>
              ))
            ) : (
              <span className="no-rules">None set</span>
            )}
          </div>
        </div>
        <div className="keyword-section">
          <label>Exclude keywords:</label>
          <div className="keyword-pills">
            {system.contentRules.excludeKeywords.length > 0 ? (
              system.contentRules.excludeKeywords.map(k => (
                <span key={k} className="pill pill-exclude">{k}</span>
              ))
            ) : (
              <span className="no-rules">None set</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions Card */}
      <div className="stat-card">
        <h3>Quick Actions</h3>
        <div className="button-group-vertical">
          <button className="btn-primary" onClick={() => onNavigate('epochs')}>
            Manage Epoch
          </button>
          <button className="btn-secondary" onClick={() => onNavigate('announcements')}>
            Post Announcement
          </button>
          <button className="btn-secondary" onClick={() => onNavigate('health')}>
            View Feed Health
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 6.2 Epoch Manager

**File: `web/src/components/admin/EpochManager.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { adminApi, Epoch } from '../../api/admin';
import { SchedulingPanel } from './SchedulingPanel';
import { formatDate, formatRelative } from '../../utils/format';

export function EpochManager() {
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function fetchEpochs() {
    try {
      const data = await adminApi.getEpochs();
      setEpochs(data.epochs);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load epochs' });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchEpochs();
  }, []);

  const currentEpoch = epochs.find(e => e.status === 'active');

  async function handleToggleVoting() {
    if (!currentEpoch) return;
    
    try {
      if (currentEpoch.votingOpen) {
        await adminApi.closeVoting();
        setMessage({ type: 'success', text: 'Voting closed' });
      } else {
        await adminApi.openVoting();
        setMessage({ type: 'success', text: 'Voting opened' });
      }
      fetchEpochs();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Action failed' });
    }
  }

  async function handleTransition(force: boolean) {
    setIsTransitioning(true);
    setMessage(null);
    
    try {
      const result = await adminApi.transitionEpoch({ force, announceResults: true });
      setMessage({ 
        type: 'success', 
        text: `Epoch ${result.newEpoch.id} started! ${result.announcement ? 'Announcement posted.' : ''}`
      });
      fetchEpochs();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Transition failed' });
    } finally {
      setIsTransitioning(false);
    }
  }

  if (isLoading) {
    return <div className="admin-loading"><div className="loading-spinner" /></div>;
  }

  return (
    <div className="epoch-manager">
      {message && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Current Epoch */}
      <div className="admin-card">
        <h2>Current Epoch</h2>
        
        {currentEpoch ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '24px', fontWeight: 600, color: '#f1f3f5' }}>
                Epoch {currentEpoch.id}
              </span>
              <span className={`status-badge ${currentEpoch.votingOpen ? 'open' : 'closed'}`}>
                {currentEpoch.votingOpen ? 'Voting Open' : 'Voting Closed'}
              </span>
            </div>

            <div className="stats-grid" style={{ marginBottom: '24px' }}>
              <div className="stat-item">
                <div className="stat-label">Votes</div>
                <div className="stat-number">{currentEpoch.voteCount}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Started</div>
                <div className="stat-number" style={{ fontSize: '16px' }}>
                  {formatRelative(currentEpoch.createdAt)}
                </div>
              </div>
              {currentEpoch.votingEndsAt && (
                <div className="stat-item">
                  <div className="stat-label">Ends</div>
                  <div className="stat-number" style={{ fontSize: '16px' }}>
                    {formatRelative(currentEpoch.votingEndsAt)}
                  </div>
                </div>
              )}
            </div>

            {/* Current Weights */}
            <h3>Current Weights</h3>
            <div style={{ marginBottom: '20px' }}>
              {Object.entries(currentEpoch.weights).map(([key, value]) => (
                <div key={key} className="stat-row">
                  <span style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                  <strong>{(value * 100).toFixed(0)}%</strong>
                </div>
              ))}
            </div>

            {/* Current Content Rules */}
            <h3>Content Rules</h3>
            <div className="keyword-section">
              <label>Include:</label>
              <div className="keyword-pills">
                {currentEpoch.contentRules.include_keywords?.length > 0 ? (
                  currentEpoch.contentRules.include_keywords.map(k => (
                    <span key={k} className="pill pill-include">{k}</span>
                  ))
                ) : (
                  <span className="no-rules">None</span>
                )}
              </div>
            </div>
            <div className="keyword-section">
              <label>Exclude:</label>
              <div className="keyword-pills">
                {currentEpoch.contentRules.exclude_keywords?.length > 0 ? (
                  currentEpoch.contentRules.exclude_keywords.map(k => (
                    <span key={k} className="pill pill-exclude">{k}</span>
                  ))
                ) : (
                  <span className="no-rules">None</span>
                )}
              </div>
            </div>

            <div className="section-divider" />

            {/* Actions */}
            <div className="button-group">
              <button className="btn-secondary" onClick={handleToggleVoting}>
                {currentEpoch.votingOpen ? 'Close Voting' : 'Reopen Voting'}
              </button>
              
              <button 
                className="btn-primary"
                onClick={() => handleTransition(false)}
                disabled={isTransitioning || currentEpoch.voteCount < 1}
              >
                {isTransitioning ? 'Transitioning...' : 'Transition to New Epoch'}
              </button>
            </div>

            {currentEpoch.voteCount < 5 && (
              <button 
                className="btn-warning"
                style={{ marginTop: '12px' }}
                onClick={() => handleTransition(true)}
                disabled={isTransitioning}
              >
                Force Transition (bypass vote minimum)
              </button>
            )}
          </>
        ) : (
          <p className="empty-state">No active epoch found</p>
        )}
      </div>

      {/* Scheduling */}
      <div className="admin-card">
        <h2>Scheduling</h2>
        <SchedulingPanel epoch={currentEpoch} onUpdate={fetchEpochs} />
      </div>

      {/* Epoch History */}
      <div className="admin-card">
        <h2>Epoch History</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Epoch</th>
              <th>Status</th>
              <th>Votes</th>
              <th>Started</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {epochs.map(epoch => (
              <tr key={epoch.id} className={epoch.status === 'active' ? 'active-row' : ''}>
                <td>{epoch.id}</td>
                <td>
                  <span className={`status-badge ${epoch.status}`}>
                    {epoch.status}
                  </span>
                </td>
                <td>{epoch.voteCount}</td>
                <td>{formatDate(epoch.createdAt)}</td>
                <td>{epoch.endedAt ? formatDate(epoch.endedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### 6.3 Scheduling Panel

**File: `web/src/components/admin/SchedulingPanel.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { adminApi, Epoch } from '../../api/admin';

interface SchedulingPanelProps {
  epoch: Epoch | undefined;
  onUpdate: () => void;
}

export function SchedulingPanel({ epoch, onUpdate }: SchedulingPanelProps) {
  const [votingEndsAt, setVotingEndsAt] = useState('');
  const [autoTransition, setAutoTransition] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (epoch) {
      setVotingEndsAt(epoch.votingEndsAt ? epoch.votingEndsAt.slice(0, 16) : '');
      setAutoTransition(epoch.autoTransition);
    }
  }, [epoch]);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);
    
    try {
      await adminApi.updateEpoch({
        votingEndsAt: votingEndsAt ? new Date(votingEndsAt).toISOString() : null,
        autoTransition
      });
      setMessage({ type: 'success', text: 'Schedule updated' });
      onUpdate();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClearSchedule() {
    setIsSaving(true);
    setMessage(null);
    
    try {
      await adminApi.updateEpoch({
        votingEndsAt: null,
        autoTransition: false
      });
      setVotingEndsAt('');
      setAutoTransition(false);
      setMessage({ type: 'success', text: 'Schedule cleared' });
      onUpdate();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to clear' });
    } finally {
      setIsSaving(false);
    }
  }

  if (!epoch) {
    return <p className="empty-state">No active epoch to schedule</p>;
  }

  // Calculate minimum date (now + 1 hour)
  const minDate = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: '16px' }}>
          {message.text}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="voting-ends">Voting Ends At</label>
        <input
          type="datetime-local"
          id="voting-ends"
          value={votingEndsAt}
          onChange={(e) => setVotingEndsAt(e.target.value)}
          min={minDate}
        />
        <p className="help-text">Leave empty for no scheduled end time</p>
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={autoTransition}
            onChange={(e) => setAutoTransition(e.target.checked)}
          />
          Auto-transition when voting ends
        </label>
        <p className="help-text">
          Automatically close voting and start a new epoch when the end time is reached.
          The bot will post an announcement with the results.
        </p>
      </div>

      <div className="button-group">
        <button 
          className="btn-primary"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Schedule'}
        </button>
        
        {(votingEndsAt || autoTransition) && (
          <button 
            className="btn-secondary"
            onClick={handleClearSchedule}
            disabled={isSaving}
          >
            Clear Schedule
          </button>
        )}
      </div>
    </div>
  );
}
```

### 6.4 Format Utilities

**File: `web/src/utils/format.ts`**

```typescript
/**
 * Format a number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format a date string to readable format
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Format a date string relative to now
 */
export function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  // Future dates
  if (diffMs < 0) {
    const futureSec = Math.abs(diffSec);
    const futureMin = Math.floor(futureSec / 60);
    const futureHour = Math.floor(futureMin / 60);
    const futureDay = Math.floor(futureHour / 24);

    if (futureDay > 0) return `in ${futureDay}d`;
    if (futureHour > 0) return `in ${futureHour}h`;
    if (futureMin > 0) return `in ${futureMin}m`;
    return 'in a moment';
  }

  // Past dates
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  
  return formatDate(dateStr);
}

/**
 * Truncate a DID for display
 */
export function truncateDid(did: string): string {
  if (did === 'system') return 'System';
  if (did.length <= 20) return did;
  return `${did.slice(0, 12)}...${did.slice(-6)}`;
}

/**
 * Format action name for display
 */
export function formatActionName(action: string): string {
  return action
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

### Phase 6 Testing

```bash
# 1. Build and start
cd web && npm run build && npm run dev

# 2. Go to /admin as admin user

# 3. Test Overview Panel
# - All cards should display data
# - Quick actions should navigate to correct tabs

# 4. Test Epoch Manager
# - Current epoch should display
# - Toggle voting should work
# - Weights and rules should display correctly

# 5. Test Scheduling Panel
# - Set a voting end date
# - Enable auto-transition
# - Save and verify it persists
# - Clear schedule and verify

# 6. Test Epoch Transition
# - Click "Transition to New Epoch"
# - Verify new epoch created
# - Verify history table updates

# 7. Test Force Transition
# - If vote count is low, force transition should appear
# - Click and verify it works
```

**Checkpoint:** Epoch management fully functional from UI.

---

## Phase 7: Frontend - Announcements, Health & Audit

### 7.1 Announcement Panel

**File: `web/src/components/admin/AnnouncementPanel.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { adminApi, Announcement } from '../../api/admin';
import { formatRelative } from '../../utils/format';

export function AnnouncementPanel() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [content, setContent] = useState('');
  const [includeLink, setIncludeLink] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function fetchAnnouncements() {
    try {
      const data = await adminApi.getAnnouncements();
      setAnnouncements(data.announcements);
    } catch (err) {
      console.error('Failed to fetch announcements', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  async function handlePost() {
    if (!content.trim() || content.length > 280) return;
    
    setIsPosting(true);
    setMessage(null);
    
    try {
      const result = await adminApi.postAnnouncement({
        content: content.trim(),
        includeEpochLink: includeLink
      });
      
      setMessage({ type: 'success', text: 'Announcement posted!' });
      setContent('');
      fetchAnnouncements();
      
      // Open in new tab
      window.open(result.announcement.postUrl, '_blank');
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to post' });
    } finally {
      setIsPosting(false);
    }
  }

  const charCount = content.length;
  const isOverLimit = charCount > 280;

  return (
    <div>
      {/* New Announcement */}
      <div className="admin-card">
        <h2>Post Announcement</h2>
        
        {message && (
          <div className={`alert alert-${message.type}`} style={{ marginBottom: '16px' }}>
            {message.text}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="announcement-content">Message</label>
          <textarea
            id="announcement-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="📢 Write your announcement..."
            rows={4}
          />
          <div className={`char-count ${isOverLimit ? 'over-limit' : ''}`}>
            {charCount}/280
          </div>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeLink}
              onChange={(e) => setIncludeLink(e.target.checked)}
            />
            Include link to voting page
          </label>
        </div>

        <button
          className="btn-primary"
          onClick={handlePost}
          disabled={isPosting || isOverLimit || !content.trim()}
        >
          {isPosting ? 'Posting...' : 'Post to Bluesky'}
        </button>
      </div>

      {/* Recent Announcements */}
      <div className="admin-card">
        <h2>Recent Announcements</h2>
        
        {isLoading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : announcements.length === 0 ? (
          <p className="empty-state">No announcements yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {announcements.map(a => (
              <div 
                key={a.id} 
                style={{ 
                  background: '#161718', 
                  borderRadius: '8px', 
                  padding: '16px' 
                }}
              >
                <p style={{ color: '#f1f3f5', margin: '0 0 12px 0', whiteSpace: 'pre-wrap' }}>
                  {a.content}
                </p>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  fontSize: '13px',
                  color: '#787c7e'
                }}>
                  <span>{formatRelative(a.postedAt)}</span>
                  <a 
                    href={a.postUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#1083fe', textDecoration: 'none' }}
                  >
                    View on Bluesky →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 7.2 Feed Health Panel

**File: `web/src/components/admin/FeedHealth.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { adminApi, FeedHealth as FeedHealthType } from '../../api/admin';
import { formatNumber, formatRelative, formatDate } from '../../utils/format';

export function FeedHealth() {
  const [health, setHealth] = useState<FeedHealthType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRescoring, setIsRescoring] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function fetchHealth() {
    try {
      const data = await adminApi.getFeedHealth();
      setHealth(data);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load feed health' });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleRescore() {
    setIsRescoring(true);
    setMessage(null);
    
    try {
      await adminApi.triggerRescore();
      setMessage({ type: 'success', text: 'Scoring started. Refreshing in 5 seconds...' });
      
      // Refresh after delay
      setTimeout(() => {
        fetchHealth();
        setIsRescoring(false);
        setMessage({ type: 'success', text: 'Scoring complete!' });
      }, 5000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to trigger rescore' });
      setIsRescoring(false);
    }
  }

  if (isLoading || !health) {
    return <div className="admin-loading"><div className="loading-spinner" /></div>;
  }

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Database Stats */}
      <div className="admin-card">
        <h2>Database</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Total Posts</div>
            <div className="stat-number">{formatNumber(health.database.totalPosts)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Last 24h</div>
            <div className="stat-number">{formatNumber(health.database.postsLast24h)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Last 7d</div>
            <div className="stat-number">{formatNumber(health.database.postsLast7d)}</div>
          </div>
        </div>
        <div className="section-divider" />
        <div className="stat-row">
          <span>Oldest post</span>
          <strong>{formatDate(health.database.oldestPost)}</strong>
        </div>
        <div className="stat-row">
          <span>Newest post</span>
          <strong>{formatRelative(health.database.newestPost)}</strong>
        </div>
      </div>

      {/* Scoring Pipeline */}
      <div className="admin-card">
        <h2>Scoring Pipeline</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Posts Scored</div>
            <div className="stat-number">{health.scoring.postsScored}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Posts Filtered</div>
            <div className="stat-number">{formatNumber(health.scoring.postsFiltered)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Duration</div>
            <div className="stat-number">
              {health.scoring.lastRunDuration ? `${health.scoring.lastRunDuration}ms` : '—'}
            </div>
          </div>
        </div>
        <div className="section-divider" />
        <div className="stat-row">
          <span>Last run</span>
          <strong>{health.scoring.lastRun ? formatRelative(health.scoring.lastRun) : 'Never'}</strong>
        </div>
        <button 
          className="btn-secondary"
          style={{ marginTop: '16px' }}
          onClick={handleRescore}
          disabled={isRescoring}
        >
          {isRescoring ? 'Scoring...' : 'Force Re-score Now'}
        </button>
      </div>

      {/* Jetstream Connection */}
      <div className="admin-card">
        <h2>Jetstream Connection</h2>
        <div className="connection-status">
          <span className={`status-indicator ${health.jetstream.connected ? 'connected' : 'disconnected'}`} />
          <span style={{ color: '#f1f3f5' }}>
            {health.jetstream.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="stat-row">
          <span>Last event</span>
          <strong>{health.jetstream.lastEvent ? formatRelative(health.jetstream.lastEvent) : 'Unknown'}</strong>
        </div>
        <div className="stat-row">
          <span>Events (5 min)</span>
          <strong>{health.jetstream.eventsLast5min}</strong>
        </div>
      </div>

      {/* Subscribers */}
      <div className="admin-card">
        <h2>Subscribers</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Total</div>
            <div className="stat-number">{health.subscribers.total}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">With Votes</div>
            <div className="stat-number">{health.subscribers.withVotes}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Active (7d)</div>
            <div className="stat-number">{health.subscribers.activeLastWeek}</div>
          </div>
        </div>
      </div>

      {/* Content Rules */}
      <div className="admin-card">
        <h2>Active Content Rules</h2>
        <div className="keyword-section">
          <label>Include keywords:</label>
          <div className="keyword-pills">
            {health.contentRules.includeKeywords.length > 0 ? (
              health.contentRules.includeKeywords.map(k => (
                <span key={k} className="pill pill-include">{k}</span>
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>
        </div>
        <div className="keyword-section">
          <label>Exclude keywords:</label>
          <div className="keyword-pills">
            {health.contentRules.excludeKeywords.length > 0 ? (
              health.contentRules.excludeKeywords.map(k => (
                <span key={k} className="pill pill-exclude">{k}</span>
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>
        </div>
        {health.contentRules.lastUpdated && (
          <p className="help-text" style={{ marginTop: '12px' }}>
            Last updated: {formatRelative(health.contentRules.lastUpdated)}
          </p>
        )}
      </div>
    </div>
  );
}
```

### 7.3 Audit Log Panel

**File: `web/src/components/admin/AuditLog.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { adminApi, AuditEntry } from '../../api/admin';
import { formatRelative, truncateDid, formatActionName } from '../../utils/format';

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'vote_cast', label: 'Votes Cast' },
  { value: 'vote_updated', label: 'Votes Updated' },
  { value: 'epoch_transition', label: 'Epoch Transitions' },
  { value: 'auto_epoch_transition', label: 'Auto Transitions' },
  { value: 'voting_opened', label: 'Voting Opened' },
  { value: 'voting_closed', label: 'Voting Closed' },
  { value: 'epoch_updated', label: 'Epoch Updated' },
  { value: 'announcement_posted', label: 'Announcements' },
  { value: 'manual_rescore', label: 'Manual Rescores' },
];

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ action: '', limit: 50 });
  const [isLoading, setIsLoading] = useState(true);

  async function fetchLog() {
    setIsLoading(true);
    try {
      const data = await adminApi.getAuditLog(filter);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch audit log', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchLog();
  }, [filter.action, filter.limit]);

  function handleLoadMore() {
    setFilter(f => ({ ...f, limit: f.limit + 50 }));
  }

  return (
    <div className="admin-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Audit Log</h2>
        <select
          value={filter.action}
          onChange={(e) => setFilter({ ...filter, action: e.target.value, limit: 50 })}
          style={{
            background: '#161718',
            border: '1px solid #2a2b2d',
            borderRadius: '8px',
            padding: '8px 12px',
            color: '#f1f3f5',
            fontSize: '14px'
          }}
        >
          {ACTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : entries.length === 0 ? (
        <p className="empty-state">No audit entries found</p>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatRelative(entry.timestamp)}
                  </td>
                  <td>
                    <span className={`status-badge ${getActionBadgeClass(entry.action)}`}>
                      {formatActionName(entry.action)}
                    </span>
                  </td>
                  <td>
                    {entry.actor === 'system' ? (
                      <span style={{ color: '#787c7e', fontStyle: 'italic' }}>System</span>
                    ) : (
                      <span title={entry.actor} style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        {truncateDid(entry.actor)}
                      </span>
                    )}
                  </td>
                  <td>
                    <code style={{ 
                      background: '#161718', 
                      padding: '4px 8px', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: '#787c7e',
                      display: 'inline-block',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {JSON.stringify(entry.details)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > filter.limit && (
            <button 
              className="btn-secondary"
              style={{ marginTop: '16px', width: '100%' }}
              onClick={handleLoadMore}
            >
              Load More ({total - filter.limit} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function getActionBadgeClass(action: string): string {
  if (action.includes('transition')) return 'active';
  if (action.includes('vote')) return 'open';
  if (action.includes('failed') || action.includes('error')) return 'error';
  return 'closed';
}
```

### Phase 7 Testing

```bash
# 1. Build and test all components
cd web && npm run build && npm run dev

# 2. Test Announcement Panel
# - Post a test announcement
# - Verify it appears in Bluesky
# - Verify it appears in recent list
# - Test rate limiting (post again immediately)

# 3. Test Feed Health
# - All stats should display
# - Jetstream connection status should be accurate
# - Force rescore should work
# - Content rules should display

# 4. Test Audit Log
# - Should show recent actions
# - Filter by action type
# - Load more should work
# - All actions from previous tests should appear

# 5. Full E2E Test
# - Start from Overview
# - Navigate through all tabs
# - Perform actions in each
# - Verify audit log captures everything
```

**Checkpoint:** All admin features functional and tested.

---

## Phase 8: Deployment & Final Testing

### 8.1 Deploy to VPS

```bash
# 1. Push all changes
git add -A
git commit -m "Add admin dashboard"
git push

# 2. SSH to VPS
ssh corgi-vps

# 3. Pull changes
cd /path/to/project
git pull

# 4. Run migration
npm run migrate

# 5. Install any new dependencies
npm install

# 6. Rebuild
npm run build

# 7. Restart service
sudo systemctl restart bluesky-feed

# 8. Check logs
journalctl -u bluesky-feed -f
```

### 8.2 Final Testing Checklist

**Access Control**
- [ ] Non-logged-in users cannot access /admin
- [ ] Non-admin users cannot access /admin
- [ ] Non-admin users don't see Admin link in nav
- [ ] Admin users see Admin link and can access /admin
- [ ] All API endpoints reject non-admin requests

**Overview**
- [ ] All stats display correctly
- [ ] Quick actions navigate to correct tabs
- [ ] Content rules display correctly

**Epoch Management**
- [ ] Current epoch displays with all details
- [ ] Open/close voting works
- [ ] Manual epoch transition works
- [ ] Force transition works (bypasses vote minimum)
- [ ] Bot announcement posts on transition
- [ ] Epoch history displays correctly

**Scheduling**
- [ ] Can set voting end date
- [ ] Can enable auto-transition
- [ ] Can clear schedule
- [ ] Scheduler auto-transitions at end time
- [ ] Bot announces auto-transitions

**Announcements**
- [ ] Can post custom announcement
- [ ] Character limit enforced (280)
- [ ] Rate limiting works (5 min between posts)
- [ ] Announcements appear in recent list
- [ ] Links to Bluesky work

**Feed Health**
- [ ] Database stats accurate
- [ ] Scoring stats accurate
- [ ] Jetstream connection status accurate
- [ ] Force rescore works
- [ ] Auto-refresh works (30 sec)

**Audit Log**
- [ ] All actions logged
- [ ] Filtering by action type works
- [ ] Pagination/load more works
- [ ] System vs user actors distinguished

**UI/UX**
- [ ] Styling matches Vote page exactly
- [ ] Responsive on mobile
- [ ] Loading states display correctly
- [ ] Error states display correctly
- [ ] Success messages display correctly

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/db/migrations/007_epoch_scheduling.sql` | NEW | Scheduling columns, announcements table |
| `src/auth/admin.ts` | NEW | Admin auth helpers |
| `src/admin/status-tracker.ts` | NEW | Scoring status tracking |
| `src/admin/routes/index.ts` | NEW | Admin route registration |
| `src/admin/routes/status.ts` | NEW | GET /admin/status |
| `src/admin/routes/epochs.ts` | NEW | Epoch management endpoints |
| `src/admin/routes/announcements.ts` | NEW | Announcement endpoints |
| `src/admin/routes/feed-health.ts` | NEW | Feed health endpoints |
| `src/admin/routes/audit-log.ts` | NEW | Audit log endpoint |
| `src/scheduler/epoch-scheduler.ts` | NEW | Cron job for auto-transitions |
| `src/bot/announcements.ts` | MODIFY | Add postCustomAnnouncement |
| `src/scoring/pipeline.ts` | MODIFY | Track scoring status |
| `src/index.ts` | MODIFY | Register admin routes, start scheduler |
| `web/src/api/admin.ts` | NEW | Admin API client |
| `web/src/hooks/useAdminStatus.ts` | NEW | Admin status hook |
| `web/src/utils/format.ts` | NEW | Formatting utilities |
| `web/src/pages/Admin.tsx` | NEW | Admin page with tabs |
| `web/src/components/admin/AdminGuard.tsx` | NEW | Auth wrapper |
| `web/src/components/admin/OverviewPanel.tsx` | NEW | Overview dashboard |
| `web/src/components/admin/EpochManager.tsx` | NEW | Epoch control |
| `web/src/components/admin/SchedulingPanel.tsx` | NEW | Scheduling UI |
| `web/src/components/admin/AnnouncementPanel.tsx` | NEW | Announcement UI |
| `web/src/components/admin/FeedHealth.tsx` | NEW | Health dashboard |
| `web/src/components/admin/AuditLog.tsx` | NEW | Activity log |
| `web/src/styles/admin.css` | NEW | Admin styling |
| `web/src/App.tsx` | MODIFY | Add /admin route |
| `web/src/components/Nav.tsx` | MODIFY | Add admin link |

---

## Notes for Claude Code

1. **Reference Vote page styling** — Look at `web/src/pages/Vote.tsx` and existing CSS for exact design patterns
2. **Test each phase** — Don't proceed to next phase until current phase tests pass
3. **Check existing code** — Some modules may already exist (audit, bot, etc.) — integrate rather than duplicate
4. **Handle edge cases** — Empty states, loading states, error states for all components
5. **Type safety** — Use TypeScript strictly, define interfaces for all API responses
6. **Mobile responsive** — Test all components at mobile widths
