/**
 * Topic Classifier
 *
 * Classifies post text against the topic taxonomy using winkNLP.
 * Uses co-occurrence disambiguation: primary terms, context terms, and anti-terms
 * combine to produce confident topic matches.
 *
 * Performance target: <1ms per post (synchronous, no DB calls).
 */

import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import type { Topic } from './taxonomy.js';

/** Initialize winkNLP once (singleton). Exported for reuse by other modules. */
export const nlp = winkNLP(model);
const its = nlp.its;

/** Sparse topic vector: slug → relevance score (0.0–1.0). */
export interface TopicVector {
  [topicSlug: string]: number;
}

/** Result of classifying a single post. */
export interface ClassificationResult {
  /** Sparse vector of matched topics with normalized scores. */
  vector: TopicVector;
  /** Slugs of all matched topics (convenience). */
  matchedTopics: string[];
  /** Number of word tokens extracted from the post. */
  tokenCount: number;
}

/**
 * Pre-processed lookup structures for a single topic.
 * Built once per taxonomy load, reused across all classify calls.
 */
interface TopicIndex {
  singleWordTerms: Set<string>;
  multiWordTerms: string[];
  singleWordContextTerms: Set<string>;
  multiWordContextTerms: string[];
  singleWordAntiTerms: Set<string>;
  multiWordAntiTerms: string[];
}

/** Cached pre-processed index keyed by taxonomy array identity. */
let cachedIndex: WeakMap<Topic[], Map<string, TopicIndex>> = new WeakMap();

/**
 * Build pre-processed lookup structures for each topic.
 * Uses WeakMap keyed on taxonomy array reference so it auto-invalidates
 * when taxonomy is reloaded.
 */
function getTopicIndex(taxonomy: Topic[]): Map<string, TopicIndex> {
  let index = cachedIndex.get(taxonomy);
  if (index) return index;

  index = new Map();
  for (const topic of taxonomy) {
    const entry: TopicIndex = {
      singleWordTerms: new Set<string>(),
      multiWordTerms: [],
      singleWordContextTerms: new Set<string>(),
      multiWordContextTerms: [],
      singleWordAntiTerms: new Set<string>(),
      multiWordAntiTerms: [],
    };

    for (const term of topic.terms) {
      const lower = term.toLowerCase();
      if (lower.includes(' ') || lower.includes('-')) {
        entry.multiWordTerms.push(lower);
      } else {
        entry.singleWordTerms.add(lower);
      }
    }

    for (const term of topic.contextTerms) {
      const lower = term.toLowerCase();
      if (lower.includes(' ') || lower.includes('-')) {
        entry.multiWordContextTerms.push(lower);
      } else {
        entry.singleWordContextTerms.add(lower);
      }
    }

    for (const term of topic.antiTerms) {
      const lower = term.toLowerCase();
      if (lower.includes(' ') || lower.includes('-')) {
        entry.multiWordAntiTerms.push(lower);
      } else {
        entry.singleWordAntiTerms.add(lower);
      }
    }

    index.set(topic.slug, entry);
  }

  cachedIndex.set(taxonomy, index);
  return index;
}

/**
 * Count single-word matches: how many tokens from the post appear in the term set.
 */
function countSingleWordHits(tokens: Set<string>, termSet: Set<string>): number {
  let count = 0;
  for (const token of tokens) {
    if (termSet.has(token)) count++;
  }
  return count;
}

/**
 * Count multi-word matches: how many multi-word terms appear as substrings in the text.
 */
function countMultiWordHits(lowerText: string, multiWordTerms: string[]): number {
  let count = 0;
  for (const term of multiWordTerms) {
    if (lowerText.includes(term)) count++;
  }
  return count;
}

/**
 * Classify a post's text against the topic taxonomy.
 * Returns a sparse topic vector (only matched topics included).
 *
 * Algorithm:
 * 1. Tokenize + normalize via winkNLP
 * 2. Extract tokens as lowercase normalized form, removing stopwords + punctuation
 * 3. Build a Set of unique normalized tokens for fast lookup
 * 4. For each topic in taxonomy:
 *    a. Count primary term matches (post tokens ∩ topic.terms)
 *    b. Count context term matches (post tokens ∩ topic.contextTerms)
 *    c. Check anti-term matches (post tokens ∩ topic.antiTerms)
 *    d. Apply co-occurrence scoring rules
 * 5. Normalize scores and return topics above threshold
 *
 * @param text - The post text to classify
 * @param taxonomy - Active topic catalog from the taxonomy module
 * @returns Classification result with sparse topic vector
 */
export function classifyPost(text: string, taxonomy: Topic[]): ClassificationResult {
  const emptyResult: ClassificationResult = { vector: {}, matchedTopics: [], tokenCount: 0 };

  if (!text || taxonomy.length === 0) return emptyResult;

  const index = getTopicIndex(taxonomy);

  // Tokenize with winkNLP
  const doc = nlp.readDoc(text);
  const tokens = doc.tokens();

  // Extract normalized tokens, filtering stopwords and non-words
  const normals = tokens.out(its.normal) as string[];
  const types = tokens.out(its.type) as string[];
  const stopFlags = tokens.out(its.stopWordFlag) as boolean[];

  const wordTokens: string[] = [];
  for (let i = 0; i < normals.length; i++) {
    if (types[i] !== 'word') continue;
    if (stopFlags[i]) continue;

    let token = normals[i];
    // Strip leading '#' from hashtags
    if (token.startsWith('#')) token = token.slice(1);
    // Skip URLs and @mentions
    if (token.startsWith('http') || token.startsWith('@')) continue;
    if (token.length === 0) continue;

    wordTokens.push(token);
  }

  if (wordTokens.length === 0) return emptyResult;

  // Build unique token set for single-word matching
  const tokenSet = new Set(wordTokens);

  // Build bigrams for multi-word matching
  // (Also used for terms that are two words joined by space)
  const lowerText = text.toLowerCase();

  // Score each topic.
  // Fixed scores (Rule 3) are absolute and NOT normalized.
  // Dynamic scores (Rules 4/5) are normalized relative to the max.
  const dynamicScores = new Map<string, number>();
  const fixedScores = new Map<string, number>();
  let maxDynamicScore = 0;

  for (const topic of taxonomy) {
    const ti = index.get(topic.slug)!;

    // Count primary hits (single-word + multi-word)
    const primaryHits =
      countSingleWordHits(tokenSet, ti.singleWordTerms) +
      countMultiWordHits(lowerText, ti.multiWordTerms);

    // Count context hits
    const contextHits =
      countSingleWordHits(tokenSet, ti.singleWordContextTerms) +
      countMultiWordHits(lowerText, ti.multiWordContextTerms);

    // Count anti-term hits
    const antiHits =
      countSingleWordHits(tokenSet, ti.singleWordAntiTerms) +
      countMultiWordHits(lowerText, ti.multiWordAntiTerms);

    // Rule 1: Anti-terms disqualify weak matches
    if (antiHits > 0 && primaryHits <= 1) continue;

    // Rule 2: No primary matches → no match
    if (primaryHits === 0) continue;

    // Rule 3: Single primary match with no context → low confidence (absolute score)
    if (primaryHits === 1 && contextHits === 0) {
      fixedScores.set(topic.slug, 0.2);
      continue;
    }

    // Rule 4: Primary match with context → confirmed topic
    let rawScore = (primaryHits * 1.0) + (contextHits * 0.5);

    // Rule 5: Multiple primary matches → strong signal bonus
    if (primaryHits >= 3) rawScore *= 1.2;

    dynamicScores.set(topic.slug, rawScore);
    if (rawScore > maxDynamicScore) maxDynamicScore = rawScore;
  }

  if (maxDynamicScore === 0 && fixedScores.size === 0) {
    return { ...emptyResult, tokenCount: wordTokens.length };
  }

  // Build final vector: normalize dynamic scores, keep fixed scores absolute
  const vector: TopicVector = {};
  const matchedTopics: string[] = [];

  for (const [slug, rawScore] of dynamicScores) {
    const normalized = rawScore / maxDynamicScore;
    if (normalized < 0.1) continue;

    vector[slug] = Math.round(normalized * 100) / 100;
    matchedTopics.push(slug);
  }

  for (const [slug, score] of fixedScores) {
    vector[slug] = score;
    matchedTopics.push(slug);
  }

  return { vector, matchedTopics, tokenCount: wordTokens.length };
}
