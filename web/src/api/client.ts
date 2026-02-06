import axios from 'axios';
import type { GovernanceWeights } from '../components/WeightSliders';

// API base URL - defaults to local dev server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Create axios instance
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessJwt');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth types
export interface LoginResponse {
  success: boolean;
  did: string;
  handle: string;
  accessJwt: string;
  expiresAt: string;
}

export interface SessionResponse {
  authenticated: boolean;
  did: string;
  handle: string;
  expiresAt: string;
}

// Auth API
export const authApi = {
  login: async (handle: string, appPassword: string): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/api/governance/auth/login', {
      handle,
      appPassword,
    });
    return response.data;
  },

  getSession: async (): Promise<SessionResponse> => {
    const response = await api.get<SessionResponse>('/api/governance/auth/session');
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/api/governance/auth/logout');
  },
};

// Vote types
export interface VotePayload {
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
}

export interface VoteResponse {
  success: boolean;
  epoch_id: number;
  vote: {
    recency_weight: number;
    engagement_weight: number;
    bridging_weight: number;
    source_diversity_weight: number;
    relevance_weight: number;
    voted_at: string;
  };
}

export interface GetVoteResponse {
  hasVoted: boolean;
  epoch_id: number;
  vote?: {
    recency_weight: number;
    engagement_weight: number;
    bridging_weight: number;
    source_diversity_weight: number;
    relevance_weight: number;
    voted_at: string;
  };
}

// Vote API
export const voteApi = {
  submitVote: async (weights: GovernanceWeights): Promise<VoteResponse> => {
    const payload: VotePayload = {
      recency_weight: weights.recency,
      engagement_weight: weights.engagement,
      bridging_weight: weights.bridging,
      source_diversity_weight: weights.sourceDiversity,
      relevance_weight: weights.relevance,
    };
    const response = await api.post<VoteResponse>('/api/governance/vote', payload);
    return response.data;
  },

  getVote: async (): Promise<GetVoteResponse> => {
    const response = await api.get<GetVoteResponse>('/api/governance/vote');
    return response.data;
  },
};

// Weights types
export interface WeightsResponse {
  epoch_id: number;
  status: string;
  weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  vote_count: number;
  created_at: string;
}

export interface EpochResponse {
  id: number;
  status: string;
  weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  vote_count: number;
  subscriber_count?: number;
  created_at: string;
  closed_at?: string;
  description?: string;
}

// Weights API
export const weightsApi = {
  getCurrent: async (): Promise<WeightsResponse> => {
    const response = await api.get<WeightsResponse>('/api/governance/weights');
    return response.data;
  },

  getHistory: async (limit = 10): Promise<{ epochs: EpochResponse[] }> => {
    const response = await api.get<{ epochs: EpochResponse[] }>('/api/governance/weights/history', {
      params: { limit },
    });
    return response.data;
  },

  getCurrentEpoch: async (): Promise<EpochResponse> => {
    const response = await api.get<any>('/api/governance/epochs/current');
    const e = response.data;
    // Transform API response to match expected interface
    return {
      id: e.epoch_id ?? e.id,
      status: e.status,
      weights: {
        recency: e.weights.recency,
        engagement: e.weights.engagement,
        bridging: e.weights.bridging,
        source_diversity: e.weights.sourceDiversity ?? e.weights.source_diversity,
        relevance: e.weights.relevance,
      },
      vote_count: e.vote_count,
      subscriber_count: e.subscriber_count,
      created_at: e.created_at,
      closed_at: e.closed_at,
      description: e.description,
    };
  },
};

// Transparency types
export interface ScoreComponent {
  raw_score: number;
  weight: number;
  weighted: number;
}

export interface PostExplanationResponse {
  post_uri: string;
  epoch_id: number;
  epoch_description: string | null;
  total_score: number;
  rank: number;
  components: {
    recency: ScoreComponent;
    engagement: ScoreComponent;
    bridging: ScoreComponent;
    source_diversity: ScoreComponent;
    relevance: ScoreComponent;
  };
  governance_weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  counterfactual: {
    pure_engagement_rank: number;
    community_governed_rank: number;
    difference: number;
  };
  scored_at: string;
  component_details: Record<string, unknown> | null;
}

export interface FeedStatsResponse {
  epoch: {
    id: number;
    status: string;
    weights: {
      recency: number;
      engagement: number;
      bridging: number;
      source_diversity: number;
      relevance: number;
    };
    created_at: string;
  };
  feed_stats: {
    total_posts_scored: number;
    unique_authors: number;
    avg_bridging_score: number;
    avg_engagement_score: number;
    median_bridging_score: number;
    median_total_score: number;
  };
  governance: {
    votes_this_epoch: number;
  };
  metrics?: {
    author_gini: number | null;
    vs_chronological_overlap: number | null;
    vs_engagement_overlap: number | null;
  };
}

export interface AuditLogEntry {
  id: number;
  action: string;
  actor_did: string | null;
  epoch_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface CounterfactualPost {
  post_uri: string;
  original_score: number;
  original_rank: number;
  counterfactual_score: number;
  counterfactual_rank: number;
  rank_delta: number;
}

export interface CounterfactualResponse {
  alternate_weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  current_weights: {
    recency: number;
    engagement: number;
    bridging: number;
    source_diversity: number;
    relevance: number;
  };
  posts: CounterfactualPost[];
  summary: {
    total_posts: number;
    posts_moved_up: number;
    posts_moved_down: number;
    posts_unchanged: number;
    max_rank_change: number;
    avg_rank_change: number;
  };
}

// Transparency API
export const transparencyApi = {
  getPostExplanation: async (uri: string): Promise<PostExplanationResponse> => {
    const response = await api.get<PostExplanationResponse>(
      `/api/transparency/post/${encodeURIComponent(uri)}`
    );
    return response.data;
  },

  getStats: async (): Promise<FeedStatsResponse> => {
    const response = await api.get<FeedStatsResponse>('/api/transparency/stats');
    return response.data;
  },

  getCounterfactual: async (
    weights: GovernanceWeights,
    limit = 50
  ): Promise<CounterfactualResponse> => {
    const response = await api.get<CounterfactualResponse>('/api/transparency/counterfactual', {
      params: {
        recency: weights.recency,
        engagement: weights.engagement,
        bridging: weights.bridging,
        source_diversity: weights.sourceDiversity,
        relevance: weights.relevance,
        limit,
      },
    });
    return response.data;
  },

  getAuditLog: async (options: {
    limit?: number;
    offset?: number;
    action?: string;
  } = {}): Promise<AuditLogResponse> => {
    const response = await api.get<AuditLogResponse>('/api/transparency/audit', {
      params: options,
    });
    return response.data;
  },

  getEpochHistory: async (limit = 20): Promise<{ epochs: EpochResponse[] }> => {
    const response = await api.get<{ epochs: any[] }>('/api/governance/weights/history', {
      params: { limit },
    });
    // Transform API response to match expected interface
    const epochs = response.data.epochs.map((e: any) => ({
      id: e.epoch_id ?? e.id,
      status: e.status,
      weights: {
        recency: e.weights.recency,
        engagement: e.weights.engagement,
        bridging: e.weights.bridging,
        source_diversity: e.weights.sourceDiversity ?? e.weights.source_diversity,
        relevance: e.weights.relevance,
      },
      vote_count: e.vote_count,
      subscriber_count: e.subscriber_count,
      created_at: e.created_at,
      closed_at: e.closed_at,
      description: e.description,
    }));
    return { epochs };
  },
};
