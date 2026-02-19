/**
 * Bot Type Definitions
 *
 * Types for the announcement bot system.
 */

import { GovernanceWeights } from '../governance/governance.types.js';

/**
 * Announcement types that can be posted.
 */
export type AnnouncementType = 'voting_opened' | 'epoch_transition' | 'manual' | 'legal_update';

/**
 * Stored announcement record.
 */
export interface Announcement {
  id: number;
  uri: string;
  cid: string;
  type: AnnouncementType;
  epochId: number | null;
  content: string;
  createdAt: Date;
  deleted: boolean;
}

/**
 * Payload for voting opened announcement.
 */
export interface VotingOpenedPayload {
  type: 'voting_opened';
  epochId: number;
  weights?: GovernanceWeights;
}

/**
 * Payload for epoch transition announcement.
 */
export interface EpochTransitionPayload {
  type: 'epoch_transition';
  oldEpochId: number;
  newEpochId: number;
  voteCount: number;
  oldWeights: GovernanceWeights;
  newWeights: GovernanceWeights;
}

/**
 * Payload for manual announcement.
 */
export interface ManualAnnouncementPayload {
  type: 'manual';
  message: string;
}

/**
 * Payload for legal document update announcement.
 */
export interface LegalUpdatePayload {
  type: 'legal_update';
  documentType: 'tos' | 'privacy' | 'both';
  url: string;
}

/**
 * Union of all announcement payload types.
 */
export type AnnouncementPayload =
  | VotingOpenedPayload
  | EpochTransitionPayload
  | ManualAnnouncementPayload
  | LegalUpdatePayload;

/**
 * Cached bot session stored in Redis.
 */
export interface BotSession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  expiresAt: string;
}

/**
 * Pinned announcement stored in Redis.
 */
export interface PinnedAnnouncement {
  uri: string;
  type: AnnouncementType;
  createdAt: string;
}

/**
 * Retry queue item for failed announcements.
 */
export interface RetryQueueItem {
  payload: AnnouncementPayload;
  attempts: number;
  lastAttempt: string;
  error?: string;
}
