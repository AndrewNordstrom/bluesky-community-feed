/**
 * Scoring Pipeline
 *
 * The main orchestrator that:
 * 1. Gets current governance epoch and weights
 * 2. Queries posts in the scoring window
 * 3. Scores each post with all 5 components
 * 4. Stores decomposed scores to PostgreSQL (GOLDEN RULE)
 * 5. Writes ranked posts to Redis for fast feed serving
 *
 * This runs every 5 minutes via the scheduler.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { scoreRecency } from './components/recency.js';
import { scoreEngagement } from './components/engagement.js';
import { scoreBridging } from './components/bridging.js';
import { scoreSourceDiversity, createAuthorCountMap } from './components/source-diversity.js';
import { scoreRelevance } from './components/relevance.js';
import {
  GovernanceEpoch,
  PostForScoring,
  ScoredPost,
  toGovernanceEpoch,
  toPostForScoring,
} from './score.types.js';
import {
  getCurrentContentRules,
  filterPosts,
  hasActiveContentRules,
} from '../governance/content-filter.js';

// Maximum time allowed for a single scoring run (2 minutes)
const SCORING_TIMEOUT_MS = 120_000;

// Track last successful run for health checks
let lastSuccessfulRunAt: Date | null = null;

/**
 * Get the timestamp of the last successful scoring run.
 */
export function getLastScoringRunAt(): Date | null {
  return lastSuccessfulRunAt;
}

/**
 * Run the complete scoring pipeline with timeout.
 * This is the main entry point called by the scheduler.
 */
export async function runScoringPipeline(): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('Scoring pipeline timed out')),
      SCORING_TIMEOUT_MS
    );
  });

  await Promise.race([
    runScoringPipelineInternal(),
    timeoutPromise,
  ]);
}

/**
 * Internal scoring pipeline logic.
 */
async function runScoringPipelineInternal(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting scoring pipeline');

  try {
    // 1. Get current governance epoch and weights
    const epoch = await getActiveEpoch();
    if (!epoch) {
      logger.error('No active governance epoch found. Cannot score.');
      return;
    }

    logger.info({ epochId: epoch.id }, 'Using governance epoch');

    // 2. Get all non-deleted posts in the scoring window
    const allPosts = await getPostsForScoring();
    logger.info({ postCount: allPosts.length, epochId: epoch.id }, 'Posts fetched for scoring');

    if (allPosts.length === 0) {
      logger.warn('No posts to score in the window');
      return;
    }

    // 2b. Apply content filtering based on governance rules
    const contentRules = await getCurrentContentRules();
    let posts = allPosts;

    if (hasActiveContentRules(contentRules)) {
      const filterResult = filterPosts(allPosts, contentRules);
      posts = filterResult.passed;

      logger.info(
        {
          epochId: epoch.id,
          totalPosts: allPosts.length,
          passedFilter: posts.length,
          filteredOut: filterResult.filtered.length,
          includeKeywords: contentRules.includeKeywords.length,
          excludeKeywords: contentRules.excludeKeywords.length,
        },
        'Content filtering applied'
      );

      if (posts.length === 0) {
        logger.warn('All posts filtered out by content rules');
        return;
      }
    }

    logger.info({ postCount: posts.length, epochId: epoch.id }, 'Scoring filtered posts');

    // 3. Score each post
    const scored = await scoreAllPosts(posts, epoch);

    // 4. Sort by total score (descending)
    scored.sort((a, b) => b.score.total - a.score.total);

    // 5. Write top posts to Redis for fast feed serving
    await writeToRedis(scored, epoch.id);

    const elapsed = Date.now() - startTime;
    logger.info(
      { elapsed, postsScored: posts.length, epochId: epoch.id },
      'Scoring pipeline complete'
    );

    // Track successful run for health checks
    lastSuccessfulRunAt = new Date();
  } catch (err) {
    logger.error({ err }, 'Scoring pipeline failed');
    throw err;
  }
}

/**
 * Get the currently active governance epoch.
 */
async function getActiveEpoch(): Promise<GovernanceEpoch | null> {
  const result = await db.query(
    `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  return toGovernanceEpoch(result.rows[0]);
}

/**
 * Get all posts within the scoring window that haven't been deleted.
 */
async function getPostsForScoring(): Promise<PostForScoring[]> {
  const cutoffMs = config.SCORING_WINDOW_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cutoffMs);

  const result = await db.query(
    `SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
            p.langs, p.has_media, p.created_at,
            COALESCE(pe.like_count, 0) as like_count,
            COALESCE(pe.repost_count, 0) as repost_count,
            COALESCE(pe.reply_count, 0) as reply_count
     FROM posts p
     LEFT JOIN post_engagement pe ON p.uri = pe.post_uri
     WHERE p.deleted = FALSE
       AND p.created_at > $1
     ORDER BY p.created_at DESC`,
    [cutoff.toISOString()]
  );

  return result.rows.map(toPostForScoring);
}

/**
 * Score all posts with all 5 components.
 * Also stores decomposed scores to the database (GOLDEN RULE).
 */
async function scoreAllPosts(
  posts: PostForScoring[],
  epoch: GovernanceEpoch
): Promise<ScoredPost[]> {
  const scored: ScoredPost[] = [];
  const authorCounts = createAuthorCountMap();

  for (const post of posts) {
    try {
      const scoredPost = await scorePost(post, epoch, authorCounts);
      scored.push(scoredPost);

      // Store to database (GOLDEN RULE: all components, weights, and weighted values)
      await storeScore(scoredPost, epoch);
    } catch (err) {
      // Log and continue - don't fail entire pipeline for one post
      logger.error({ err, uri: post.uri }, 'Failed to score post');
    }
  }

  return scored;
}

/**
 * Score a single post with all 5 components.
 */
async function scorePost(
  post: PostForScoring,
  epoch: GovernanceEpoch,
  authorCounts: Map<string, number>
): Promise<ScoredPost> {
  // Calculate raw component scores (0.0-1.0)
  const recency = scoreRecency(post.createdAt, config.SCORING_WINDOW_HOURS);
  const engagement = scoreEngagement(post.likeCount, post.repostCount, post.replyCount);
  const bridging = await scoreBridging(post.uri, post.authorDid);
  const sourceDiversity = scoreSourceDiversity(post.authorDid, authorCounts);
  const relevance = scoreRelevance(post);

  // Get weights from governance epoch
  const weights = {
    recency: epoch.recencyWeight,
    engagement: epoch.engagementWeight,
    bridging: epoch.bridgingWeight,
    sourceDiversity: epoch.sourceDiversityWeight,
    relevance: epoch.relevanceWeight,
  };

  // Calculate weighted values
  const weighted = {
    recency: recency * weights.recency,
    engagement: engagement * weights.engagement,
    bridging: bridging * weights.bridging,
    sourceDiversity: sourceDiversity * weights.sourceDiversity,
    relevance: relevance * weights.relevance,
  };

  // Calculate total score (sum of weighted components)
  const total =
    weighted.recency +
    weighted.engagement +
    weighted.bridging +
    weighted.sourceDiversity +
    weighted.relevance;

  return {
    uri: post.uri,
    authorDid: post.authorDid,
    score: {
      raw: { recency, engagement, bridging, sourceDiversity, relevance },
      weights,
      weighted,
      total,
    },
  };
}

/**
 * Store the decomposed score to the database.
 * GOLDEN RULE: Store raw, weight, AND weighted values for every component.
 */
async function storeScore(scoredPost: ScoredPost, epoch: GovernanceEpoch): Promise<void> {
  const { uri } = scoredPost;
  const { raw, weights, weighted, total } = scoredPost.score;

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
      uri,
      epoch.id,
      raw.recency,
      raw.engagement,
      raw.bridging,
      raw.sourceDiversity,
      raw.relevance,
      weights.recency,
      weights.engagement,
      weights.bridging,
      weights.sourceDiversity,
      weights.relevance,
      weighted.recency,
      weighted.engagement,
      weighted.bridging,
      weighted.sourceDiversity,
      weighted.relevance,
      total,
      JSON.stringify({}), // component_details: placeholder for future explainability data
    ]
  );
}

/**
 * Write the ranked posts to Redis for fast feed serving.
 */
async function writeToRedis(scored: ScoredPost[], epochId: number): Promise<void> {
  // Take top N posts for the feed
  const topPosts = scored.slice(0, config.FEED_MAX_POSTS);

  if (topPosts.length === 0) {
    logger.warn('No posts to write to Redis');
    return;
  }

  // Use Redis pipeline for atomic batch write
  const pipeline = redis.pipeline();

  // Delete old feed
  pipeline.del('feed:current');

  // Add all posts to sorted set (score = total_score)
  for (const post of topPosts) {
    pipeline.zadd('feed:current', post.score.total, post.uri);
  }

  // Store metadata
  pipeline.set('feed:epoch', epochId.toString());
  pipeline.set('feed:updated_at', new Date().toISOString());
  pipeline.set('feed:count', topPosts.length.toString());

  await pipeline.exec();

  logger.info({ postCount: topPosts.length, epochId }, 'Feed written to Redis');
}
