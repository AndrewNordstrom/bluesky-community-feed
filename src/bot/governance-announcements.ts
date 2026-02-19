/**
 * Governance Announcements
 *
 * Phase-cycle specific announcement helpers used by admin routes and scheduler.
 */

import { db } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { ContentRules, GovernanceWeights } from '../governance/governance.types.js';
import { postAnnouncementSafe } from './safe-poster.js';

interface EpochLike {
  id: number;
  votingEndsAt?: string | null;
}

interface ScheduledVoteLike {
  id: number;
  startsAt: string;
  durationHours: number;
}

interface ResultsChanges {
  oldWeights: GovernanceWeights;
  newWeights: GovernanceWeights;
  oldContentRules: ContentRules;
  newContentRules: ContentRules;
}

function formatWeightDelta(label: string, oldValue: number, newValue: number): string {
  const oldPct = Math.round(oldValue * 100);
  const newPct = Math.round(newValue * 100);
  const delta = newPct - oldPct;

  if (delta === 0) {
    return `- ${label}: ${oldPct}% (unchanged)`;
  }

  const sign = delta > 0 ? '+' : '';
  return `- ${label}: ${oldPct}% -> ${newPct}% (${sign}${delta}%)`;
}

async function isAnnouncementEnabled(key: string): Promise<boolean> {
  try {
    const result = await db.query<{ enabled: boolean }>(
      `SELECT enabled
       FROM announcement_settings
       WHERE key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return true;
    }

    return Boolean(result.rows[0].enabled);
  } catch (error) {
    logger.warn({ error, key }, 'Failed to read announcement settings, defaulting to enabled');
    return true;
  }
}

async function publishIfEnabled(settingKey: string, message: string): Promise<void> {
  if (!(await isAnnouncementEnabled(settingKey))) {
    logger.debug({ settingKey }, 'Announcement skipped because setting is disabled');
    return;
  }

  await postAnnouncementSafe({
    type: 'manual',
    message,
  });
}

export async function announceVotingOpen(epoch: EpochLike, duration: string): Promise<void> {
  const voteUrl = `https://${config.FEEDGEN_HOSTNAME}/vote`;
  const message =
    `Voting is now open for Round #${epoch.id}.\n\n` +
    `Help decide how this feed ranks posts.\n` +
    `Vote here: ${voteUrl}\n\n` +
    `Voting window: ${duration}.`;

  await publishIfEnabled('voting_opened', message);
}

export async function announceVotingReminder(epoch: EpochLike, hoursLeft: number): Promise<void> {
  const voteUrl = `https://${config.FEEDGEN_HOSTNAME}/vote`;
  const message =
    `Reminder: Voting for Round #${epoch.id} closes in about ${hoursLeft} hours.\n\n` +
    `Cast or update your vote: ${voteUrl}`;

  await publishIfEnabled('voting_reminder_24h', message);
}

export async function announceVotingClosed(epoch: EpochLike, voteCount: number): Promise<void> {
  const message =
    `Voting for Round #${epoch.id} has closed.\n\n` +
    `${voteCount} community member(s) participated.\n` +
    `Results are pending admin review.`;

  await publishIfEnabled('voting_closed', message);
}

export async function announceResultsApproved(
  epoch: EpochLike,
  changes: ResultsChanges
): Promise<void> {
  const lines: string[] = [
    `Round #${epoch.id} results are now live.`,
    '',
    formatWeightDelta('Recency', changes.oldWeights.recency, changes.newWeights.recency),
    formatWeightDelta('Engagement', changes.oldWeights.engagement, changes.newWeights.engagement),
    formatWeightDelta('Bridging', changes.oldWeights.bridging, changes.newWeights.bridging),
    formatWeightDelta(
      'Source Diversity',
      changes.oldWeights.sourceDiversity,
      changes.newWeights.sourceDiversity
    ),
    formatWeightDelta('Relevance', changes.oldWeights.relevance, changes.newWeights.relevance),
  ];

  const includeAdded = changes.newContentRules.includeKeywords.filter(
    (keyword) => !changes.oldContentRules.includeKeywords.includes(keyword)
  );
  const excludeAdded = changes.newContentRules.excludeKeywords.filter(
    (keyword) => !changes.oldContentRules.excludeKeywords.includes(keyword)
  );

  if (includeAdded.length > 0 || excludeAdded.length > 0) {
    lines.push('', 'Keyword changes:');
    if (includeAdded.length > 0) {
      lines.push(`- Added include: ${includeAdded.join(', ')}`);
    }
    if (excludeAdded.length > 0) {
      lines.push(`- Added exclude: ${excludeAdded.join(', ')}`);
    }
  }

  await publishIfEnabled('results_approved', lines.join('\n'));
}

export async function announceVoteScheduled(scheduledVote: ScheduledVoteLike): Promise<void> {
  const message =
    `Next governance vote is scheduled for ${new Date(scheduledVote.startsAt).toISOString()}.\n\n` +
    `Planned duration: ${scheduledVote.durationHours} hours.\n` +
    `Round will open automatically on schedule.`;

  await publishIfEnabled('vote_scheduled', message);
}

export async function announceLegalUpdate(
  documentType: 'tos' | 'privacy' | 'both'
): Promise<void> {
  if (!(await isAnnouncementEnabled('legal_update'))) {
    logger.debug('Legal update announcement skipped: setting disabled');
    return;
  }

  const baseUrl = `https://${config.FEEDGEN_HOSTNAME}`;
  const url =
    documentType === 'privacy'
      ? `${baseUrl}/privacy`
      : `${baseUrl}/tos`;

  await postAnnouncementSafe({
    type: 'legal_update',
    documentType,
    url,
  });
}
