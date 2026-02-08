/**
 * Admin API Client
 *
 * API functions for admin dashboard endpoints.
 * All requests include credentials and proper auth headers.
 */

import { api } from './client';

// Types
export interface GovernanceWeights {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

export interface ContentRules {
  includeKeywords: string[];
  excludeKeywords: string[];
}

export interface RoundSummary {
  id: number;
  status: string;
  voteCount: number;
  createdAt: string;
  closedAt: string | null;
  votingEndsAt: string | null;
  autoTransition: boolean;
  weights: GovernanceWeights;
  contentRules: ContentRules;
}

export interface GovernanceStatus {
  currentRound: RoundSummary | null;
  rounds: RoundSummary[];
  weights: GovernanceWeights | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  votingEndsAt: string | null;
  autoTransition: boolean;
}

export interface RoundDetails {
  round: RoundSummary;
  startingWeights: GovernanceWeights;
  endingWeights: GovernanceWeights;
  startingRules: ContentRules;
  endingRules: ContentRules;
  voteCount: number;
  weightConfigurations: Array<{
    count: number;
    weights: GovernanceWeights | null;
  }>;
  duration: {
    startedAt: string;
    endedAt: string | null;
    durationMs: number;
  };
  auditTrail: Array<{
    action: string;
    details: Record<string, unknown> | null;
    created_at: string;
  }>;
}

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
      weights: GovernanceWeights;
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
  feedSize?: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  actor: string;
  epochId?: number;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface SchedulerStatus {
  scheduler: {
    running: boolean;
    schedule: string;
  };
  pendingTransitions: Array<{
    epochId: number;
    votingEndsAt: string;
    autoTransition: boolean;
    readyForTransition: boolean;
  }>;
}

// API Functions
export const adminApi = {
  async getStatus(): Promise<AdminStatus> {
    const response = await api.get('/api/admin/status');
    return response.data;
  },

  async getEpochs(): Promise<{ epochs: Epoch[] }> {
    const response = await api.get('/api/admin/epochs');
    return response.data;
  },

  async updateEpoch(data: {
    votingOpen?: boolean;
    votingEndsAt?: string | null;
    autoTransition?: boolean;
  }): Promise<{ success: boolean; epoch: Partial<Epoch> }> {
    const response = await api.patch('/api/admin/epochs/current', data);
    return response.data;
  },

  async transitionEpoch(options: { force?: boolean; announceResults?: boolean } = {}): Promise<{
    success: boolean;
    previousEpoch: { id: number; totalVotes: number };
    newEpoch: { id: number };
    announcement: { postUrl: string } | null;
  }> {
    const response = await api.post('/api/admin/epochs/transition', options);
    return response.data;
  },

  async closeVoting(): Promise<{ success: boolean }> {
    const response = await api.post('/api/admin/epochs/close-voting');
    return response.data;
  },

  async openVoting(): Promise<{ success: boolean }> {
    const response = await api.post('/api/admin/epochs/open-voting');
    return response.data;
  },

  async getAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const response = await api.get('/api/admin/announcements');
    return response.data;
  },

  async postAnnouncement(data: { content: string; includeEpochLink?: boolean }): Promise<{
    success: boolean;
    announcement: { postUri: string; postUrl: string };
  }> {
    const response = await api.post('/api/admin/announcements', data);
    return response.data;
  },

  async getFeedHealth(): Promise<FeedHealth> {
    const response = await api.get('/api/admin/feed-health');
    return response.data;
  },

  async triggerRescore(): Promise<{ success: boolean; message: string }> {
    const response = await api.post('/api/admin/feed/rescore');
    return response.data;
  },

  async getAuditLog(params: { action?: string; actor?: string; limit?: number } = {}): Promise<{
    entries: AuditEntry[];
    total: number;
  }> {
    const response = await api.get('/api/admin/audit-log', { params });
    return response.data;
  },

  async getSchedulerStatus(): Promise<SchedulerStatus> {
    const response = await api.get('/api/admin/scheduler/status');
    return response.data;
  },

  async triggerSchedulerCheck(): Promise<{
    success: boolean;
    transitioned: number;
    errors: number;
  }> {
    const response = await api.post('/api/admin/scheduler/check');
    return response.data;
  },

  async getGovernanceStatus(): Promise<GovernanceStatus> {
    const response = await api.get('/api/admin/governance');
    return response.data;
  },

  async updateContentRules(contentRules: {
    includeKeywords?: string[];
    excludeKeywords?: string[];
  }): Promise<{ success: boolean; rules: ContentRules; rescoreTriggered: boolean }> {
    const response = await api.patch('/api/admin/governance/content-rules', contentRules);
    return response.data;
  },

  async addKeyword(type: 'include' | 'exclude', keyword: string): Promise<{
    success: boolean;
    rules: ContentRules;
    rescoreTriggered: boolean;
  }> {
    const response = await api.post('/api/admin/governance/content-rules/keyword', { type, keyword });
    return response.data;
  },

  async removeKeyword(
    type: 'include' | 'exclude',
    keyword: string,
    confirm?: boolean
  ): Promise<{ success: boolean; rules: ContentRules; rescoreTriggered: boolean }> {
    const response = await api.delete('/api/admin/governance/content-rules/keyword', {
      data: { type, keyword, confirm },
    });
    return response.data;
  },

  async updateWeights(weights: Partial<GovernanceWeights>): Promise<{
    success: boolean;
    weights: GovernanceWeights;
    rescoreTriggered: boolean;
  }> {
    const response = await api.patch('/api/admin/governance/weights', weights);
    return response.data;
  },

  async extendVoting(hours: number): Promise<{ success: boolean; round: RoundSummary }> {
    const response = await api.post('/api/admin/governance/extend-voting', { hours });
    return response.data;
  },

  async applyResults(): Promise<{
    success: boolean;
    voteCount: number;
    appliedWeights: boolean;
    weights: GovernanceWeights;
    contentRules: ContentRules;
    round: RoundSummary;
    rescoreTriggered: boolean;
  }> {
    const response = await api.post('/api/admin/governance/apply-results');
    return response.data;
  },

  async getRoundDetails(id: number): Promise<RoundDetails> {
    const response = await api.get(`/api/admin/governance/rounds/${id}`);
    return response.data;
  },

  async endRound(force = false): Promise<{ success: boolean; newRoundId: number }> {
    const response = await api.post('/api/admin/governance/end-round', { force });
    return response.data;
  },
};
