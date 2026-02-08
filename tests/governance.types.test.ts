import { describe, expect, it } from 'vitest';
import { normalizeWeights, validateWeightsSum } from '../src/governance/governance.types.js';

describe('normalizeWeights', () => {
  it('handles extreme rounding input without producing negative weights', () => {
    const normalized = normalizeWeights({
      recency: 0.0009543647729999272,
      engagement: 0.9326854650491594,
      bridging: 0.109653705223129,
      sourceDiversity: 0.9620373270560592,
      relevance: 0.5097398050791935,
    });

    for (const value of Object.values(normalized)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }

    const sum = Object.values(normalized).reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(validateWeightsSum(normalized)).toBe(true);
  });

  it('throws when weights cannot be normalized due to non-finite input', () => {
    expect(() =>
      normalizeWeights({
        recency: Number.NaN,
        engagement: 0.25,
        bridging: 0.25,
        sourceDiversity: 0.25,
        relevance: 0.25,
      })
    ).toThrow('Weights must be finite numbers');
  });
});
