/**
 * Transparency Metrics
 *
 * Statistical calculations for feed transparency.
 * - Gini coefficient: measures author concentration
 * - Jaccard similarity: measures overlap between rankings
 */

/**
 * Calculate Gini coefficient for a distribution.
 *
 * Measures inequality in a distribution:
 * - 0 = perfect equality (all values equal)
 * - 1 = perfect inequality (one value has everything)
 *
 * Used for author concentration: how dominated is the feed by a few authors?
 *
 * @param values - Array of non-negative values (e.g., post counts per author)
 * @returns Gini coefficient between 0 and 1
 */
export function calculateGiniCoefficient(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  // Filter out zeros and sort ascending
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = sorted.length;

  if (n === 0) return 0;
  if (n === 1) return 0;

  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;

  // Gini formula: G = (2 * Σ(i * x_i)) / (n * Σx_i) - (n + 1) / n
  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i + 1) * sorted[i];
  }

  const gini = (2 * numerator) / (n * sum) - (n + 1) / n;

  // Clamp to [0, 1] to handle floating point errors
  return Math.max(0, Math.min(1, gini));
}

/**
 * Calculate Jaccard similarity between two sets.
 *
 * Measures overlap: |A ∩ B| / |A ∪ B|
 * - 0 = no overlap
 * - 1 = identical sets
 *
 * Used to compare rankings: how similar is the governed feed to pure engagement?
 *
 * @param setA - First set of items (e.g., post URIs)
 * @param setB - Second set of items
 * @returns Jaccard similarity between 0 and 1
 */
export function calculateJaccardSimilarity(setA: string[], setB: string[]): number {
  if (setA.length === 0 && setB.length === 0) return 1;
  if (setA.length === 0 || setB.length === 0) return 0;

  const a = new Set(setA);
  const b = new Set(setB);

  let intersectionSize = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersectionSize++;
    }
  }

  const unionSize = a.size + b.size - intersectionSize;

  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

/**
 * Calculate Shannon entropy of a probability distribution.
 *
 * Measures diversity/uncertainty:
 * - 0 = all probability in one category (no diversity)
 * - log2(n) = uniform distribution (maximum diversity)
 *
 * Normalized to [0, 1] by dividing by log2(n).
 *
 * @param distribution - Array of counts or probabilities
 * @returns Normalized entropy between 0 and 1
 */
export function calculateNormalizedEntropy(distribution: number[]): number {
  const filtered = distribution.filter((v) => v > 0);
  const n = filtered.length;

  if (n <= 1) return 0;

  const total = filtered.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  // Convert to probabilities and calculate entropy
  let entropy = 0;
  for (const count of filtered) {
    const p = count / total;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize by maximum possible entropy (uniform distribution)
  const maxEntropy = Math.log2(n);

  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Calculate author concentration metrics for a feed.
 *
 * @param authorPostCounts - Map of author DID to post count in feed
 * @returns Object with Gini and top-author percentage
 */
export function calculateAuthorConcentration(authorPostCounts: Map<string, number>): {
  gini: number;
  topAuthorPercentage: number;
  top5AuthorsPercentage: number;
} {
  const counts = Array.from(authorPostCounts.values());

  if (counts.length === 0) {
    return { gini: 0, topAuthorPercentage: 0, top5AuthorsPercentage: 0 };
  }

  const total = counts.reduce((a, b) => a + b, 0);
  const sorted = counts.slice().sort((a, b) => b - a); // Descending

  const gini = calculateGiniCoefficient(counts);
  const topAuthorPercentage = total > 0 ? (sorted[0] / total) * 100 : 0;
  const top5Sum = sorted.slice(0, 5).reduce((a, b) => a + b, 0);
  const top5AuthorsPercentage = total > 0 ? (top5Sum / total) * 100 : 0;

  return {
    gini,
    topAuthorPercentage,
    top5AuthorsPercentage,
  };
}

/**
 * Compare two rankings and return similarity metrics.
 *
 * @param rankingA - First ranking (array of post URIs in order)
 * @param rankingB - Second ranking
 * @param topN - How many top posts to compare (default: all)
 * @returns Object with Jaccard similarity and rank correlation
 */
export function compareRankings(
  rankingA: string[],
  rankingB: string[],
  topN?: number
): {
  jaccard: number;
  topNOverlap: number;
  rankCorrelation: number;
} {
  const n = topN ?? Math.min(rankingA.length, rankingB.length);
  const topA = rankingA.slice(0, n);
  const topB = rankingB.slice(0, n);

  // Jaccard similarity of top-N
  const jaccard = calculateJaccardSimilarity(topA, topB);

  // Overlap percentage
  const setA = new Set(topA);
  const setB = new Set(topB);
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap++;
  }
  const topNOverlap = n > 0 ? (overlap / n) * 100 : 0;

  // Spearman rank correlation (simplified)
  // For items in both rankings, calculate rank correlation
  const commonItems = topA.filter((item) => setB.has(item));
  let rankCorrelation = 0;

  if (commonItems.length >= 2) {
    const rankMapA = new Map<string, number>();
    const rankMapB = new Map<string, number>();

    topA.forEach((item, i) => rankMapA.set(item, i + 1));
    topB.forEach((item, i) => rankMapB.set(item, i + 1));

    // Calculate Spearman correlation
    let sumDSquared = 0;
    for (const item of commonItems) {
      const rankA = rankMapA.get(item)!;
      const rankB = rankMapB.get(item)!;
      sumDSquared += Math.pow(rankA - rankB, 2);
    }

    const m = commonItems.length;
    rankCorrelation = 1 - (6 * sumDSquared) / (m * (m * m - 1));
  }

  return {
    jaccard,
    topNOverlap,
    rankCorrelation,
  };
}
