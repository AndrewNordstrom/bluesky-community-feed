/**
 * Embedding Ingestion Classifier Tests
 *
 * Tests the single-post embedding classifier (embedding-gate.ts) and its
 * integration with the post handler. Verifies fail-open behavior, threshold
 * filtering, and correct vector replacement logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ---

const {
  embedTextsMock,
  cosineSimilarityMock,
  isEmbedderReadyMock,
  getTopicsWithEmbeddingsMock,
  configMock,
} = vi.hoisted(() => ({
  embedTextsMock: vi.fn(),
  cosineSimilarityMock: vi.fn(),
  isEmbedderReadyMock: vi.fn(),
  getTopicsWithEmbeddingsMock: vi.fn(),
  configMock: {
    TOPIC_EMBEDDING_ENABLED: true,
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.35,
  },
}));

vi.mock('../src/scoring/topics/embedder.js', () => ({
  embedTexts: embedTextsMock,
  cosineSimilarity: cosineSimilarityMock,
  isEmbedderReady: isEmbedderReadyMock,
}));

vi.mock('../src/scoring/topics/taxonomy.js', () => ({
  getTopicsWithEmbeddings: getTopicsWithEmbeddingsMock,
}));

vi.mock('../src/config.js', () => ({
  config: configMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { classifyPostByEmbedding } from '../src/ingestion/embedding-gate.js';

// --- Test data ---

const fakeTopic = (slug: string, embedding: Float32Array) => ({
  slug,
  name: slug,
  description: null,
  parentSlug: null,
  terms: [],
  contextTerms: [],
  antiTerms: [],
  embedding,
});

const fakeEmbedding = new Float32Array(384);

describe('classifyPostByEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.TOPIC_EMBEDDING_MIN_SIMILARITY = 0.35;
    isEmbedderReadyMock.mockReturnValue(true);
    embedTextsMock.mockResolvedValue([fakeEmbedding]);
    getTopicsWithEmbeddingsMock.mockReturnValue([
      fakeTopic('ai-machine-learning', new Float32Array(384)),
      fakeTopic('software-development', new Float32Array(384)),
      fakeTopic('cybersecurity', new Float32Array(384)),
    ]);
  });

  it('returns embedding-based topic vector for on-topic text', async () => {
    cosineSimilarityMock
      .mockReturnValueOnce(0.72)  // ai-ml
      .mockReturnValueOnce(0.41)  // sw-dev
      .mockReturnValueOnce(0.15); // cybersecurity

    const result = await classifyPostByEmbedding('training a neural network model');

    expect(result).not.toBeNull();
    expect(result!.method).toBe('embedding');
    expect(result!.vector['ai-machine-learning']).toBe(0.72);
    expect(result!.vector['software-development']).toBe(0.41);
    expect(result!.vector['cybersecurity']).toBeUndefined(); // below threshold
  });

  it('returns empty vector for off-topic text', async () => {
    cosineSimilarityMock.mockReturnValue(0.1); // all below threshold

    const result = await classifyPostByEmbedding('just walking my dog today');

    expect(result).not.toBeNull();
    expect(result!.method).toBe('embedding');
    expect(Object.keys(result!.vector)).toHaveLength(0);
  });

  it('returns null when embedder not ready (fail-open)', async () => {
    isEmbedderReadyMock.mockReturnValue(false);

    const result = await classifyPostByEmbedding('any text');

    expect(result).toBeNull();
    expect(embedTextsMock).not.toHaveBeenCalled();
  });

  it('respects TOPIC_EMBEDDING_MIN_SIMILARITY threshold', async () => {
    configMock.TOPIC_EMBEDDING_MIN_SIMILARITY = 0.50;
    cosineSimilarityMock
      .mockReturnValueOnce(0.55)  // ai-ml: above
      .mockReturnValueOnce(0.49)  // sw-dev: below
      .mockReturnValueOnce(0.50); // cybersecurity: at threshold (included)

    const result = await classifyPostByEmbedding('machine learning project');

    expect(result!.vector['ai-machine-learning']).toBe(0.55);
    expect(result!.vector['software-development']).toBeUndefined();
    expect(result!.vector['cybersecurity']).toBe(0.5);
  });

  it('matches multiple topics when text is relevant to several', async () => {
    cosineSimilarityMock
      .mockReturnValueOnce(0.65)  // ai-ml
      .mockReturnValueOnce(0.58)  // sw-dev
      .mockReturnValueOnce(0.42); // cybersecurity

    const result = await classifyPostByEmbedding('building an AI-powered security tool');

    expect(Object.keys(result!.vector)).toHaveLength(3);
  });

  it('handles empty text input', async () => {
    const result = await classifyPostByEmbedding('');

    expect(result).not.toBeNull();
    expect(result!.method).toBe('keyword_fallback');
    expect(Object.keys(result!.vector)).toHaveLength(0);
    expect(embedTextsMock).not.toHaveBeenCalled();
  });

  it('similarity scores are rounded to 2 decimal places', async () => {
    cosineSimilarityMock
      .mockReturnValueOnce(0.7234567)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.1);

    const result = await classifyPostByEmbedding('testing rounding');

    expect(result!.vector['ai-machine-learning']).toBe(0.72);
  });

  it('returns null when no topic embeddings available', async () => {
    getTopicsWithEmbeddingsMock.mockReturnValue(null);

    const result = await classifyPostByEmbedding('any text');

    expect(result).toBeNull();
  });

  it('returns null when topic embeddings array is empty', async () => {
    getTopicsWithEmbeddingsMock.mockReturnValue([]);

    const result = await classifyPostByEmbedding('any text');

    expect(result).toBeNull();
  });
});
