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
    sourceDiversity: number;
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
    sourceDiversity: number;
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
    const response = await api.get<EpochResponse>('/api/governance/epochs/current');
    return response.data;
  },
};
