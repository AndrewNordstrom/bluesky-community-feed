import { useState, useCallback, useEffect } from 'react';

/**
 * Weight configuration for the governance system.
 * All values must be 0.0-1.0 and sum to 1.0.
 */
export interface GovernanceWeights {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

interface WeightSlidersProps {
  initialWeights?: GovernanceWeights;
  onChange?: (weights: GovernanceWeights) => void;
  disabled?: boolean;
}

const DEFAULT_WEIGHTS: GovernanceWeights = {
  recency: 0.2,
  engagement: 0.2,
  bridging: 0.2,
  sourceDiversity: 0.2,
  relevance: 0.2,
};

const WEIGHT_LABELS: Record<keyof GovernanceWeights, { name: string; description: string }> = {
  recency: {
    name: 'Recency',
    description: 'How much to favor newer posts over older ones',
  },
  engagement: {
    name: 'Engagement',
    description: 'How much to favor posts with more likes, reposts, and replies',
  },
  bridging: {
    name: 'Bridging',
    description: 'How much to favor posts that appeal across different communities',
  },
  sourceDiversity: {
    name: 'Source Diversity',
    description: 'How much to penalize seeing too many posts from the same author',
  },
  relevance: {
    name: 'Relevance',
    description: 'How much to favor posts matching your interests (future feature)',
  },
};

const WEIGHT_KEYS: (keyof GovernanceWeights)[] = [
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
];

/**
 * WeightSliders Component
 *
 * 5 linked sliders that always sum to 1.0.
 * When user drags one slider, others adjust proportionally.
 */
export function WeightSliders({ initialWeights, onChange, disabled = false }: WeightSlidersProps) {
  const [weights, setWeights] = useState<GovernanceWeights>(initialWeights ?? DEFAULT_WEIGHTS);

  // Update weights when initialWeights changes
  useEffect(() => {
    if (initialWeights) {
      setWeights(initialWeights);
    }
  }, [initialWeights]);

  /**
   * Handle slider change with linked adjustment.
   *
   * Algorithm:
   * 1. User changes slider X from oldValue to newValue
   * 2. delta = newValue - oldValue
   * 3. Distribute -delta across other sliders proportionally to their current values
   * 4. If any slider would go negative, clamp to 0 and redistribute remainder
   * 5. After all adjustments, normalize to ensure exact sum of 1.0
   */
  const handleSliderChange = useCallback(
    (key: keyof GovernanceWeights, newValue: number) => {
      setWeights((prevWeights) => {
        const oldValue = prevWeights[key];
        const delta = newValue - oldValue;

        if (Math.abs(delta) < 0.001) {
          return prevWeights;
        }

        // Calculate sum of other weights
        const otherKeys = WEIGHT_KEYS.filter((k) => k !== key);
        const otherSum = otherKeys.reduce((sum, k) => sum + prevWeights[k], 0);

        // If other weights are all zero, can't redistribute
        if (otherSum < 0.001 && delta > 0) {
          return prevWeights;
        }

        // Create new weights
        const newWeights = { ...prevWeights };
        newWeights[key] = Math.max(0, Math.min(1, newValue));

        // Distribute -delta proportionally to other sliders
        const amountToDistribute = -delta;

        if (otherSum > 0.001) {
          for (const otherKey of otherKeys) {
            const proportion = prevWeights[otherKey] / otherSum;
            const adjustment = amountToDistribute * proportion;
            newWeights[otherKey] = Math.max(0, prevWeights[otherKey] + adjustment);
          }
        } else {
          // If all others are zero, distribute equally
          const equalShare = amountToDistribute / otherKeys.length;
          for (const otherKey of otherKeys) {
            newWeights[otherKey] = Math.max(0, equalShare);
          }
        }

        // Normalize to ensure exact sum of 1.0
        const total = WEIGHT_KEYS.reduce((sum, k) => sum + newWeights[k], 0);
        if (total > 0) {
          for (const k of WEIGHT_KEYS) {
            newWeights[k] = Math.round((newWeights[k] / total) * 1000) / 1000;
          }

          // Fix rounding error by adjusting the changed slider
          const currentSum = WEIGHT_KEYS.reduce((sum, k) => sum + newWeights[k], 0);
          newWeights[key] = Math.round((newWeights[key] + (1.0 - currentSum)) * 1000) / 1000;
        }

        return newWeights;
      });
    },
    []
  );

  // Notify parent of changes
  useEffect(() => {
    onChange?.(weights);
  }, [weights, onChange]);

  // Calculate sum for validation display
  const sum = WEIGHT_KEYS.reduce((s, k) => s + weights[k], 0);
  const isValid = Math.abs(sum - 1.0) < 0.01;

  return (
    <div className="weight-sliders">
      <div className="sliders-header">
        <h3>Algorithm Weights</h3>
        <div className={`sum-indicator ${isValid ? 'valid' : 'invalid'}`}>
          Total: {(sum * 100).toFixed(1)}%
          {isValid ? ' ✓' : ' (must equal 100%)'}
        </div>
      </div>

      <div className="sliders-container">
        {WEIGHT_KEYS.map((key) => {
          const { name, description } = WEIGHT_LABELS[key];
          const value = weights[key];
          const percentage = (value * 100).toFixed(1);

          return (
            <div key={key} className="slider-row">
              <div className="slider-label">
                <span className="slider-name">{name}</span>
                <span className="slider-value">{percentage}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={value * 100}
                onChange={(e) => handleSliderChange(key, parseFloat(e.target.value) / 100)}
                disabled={disabled}
                className="slider-input"
                aria-label={`${name} weight`}
              />
              <div className="slider-description">{description}</div>
            </div>
          );
        })}
      </div>

      <style>{`
        .weight-sliders {
          padding: 1rem;
          border-radius: 8px;
          background: #f8f9fa;
        }

        .sliders-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }

        .sliders-header h3 {
          margin: 0;
          font-size: 1.25rem;
          color: #1a1a2e;
        }

        .sum-indicator {
          font-size: 0.875rem;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
        }

        .sum-indicator.valid {
          background: #d4edda;
          color: #155724;
        }

        .sum-indicator.invalid {
          background: #f8d7da;
          color: #721c24;
        }

        .sliders-container {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .slider-row {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .slider-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .slider-name {
          font-weight: 600;
          color: #1a1a2e;
        }

        .slider-value {
          font-family: monospace;
          font-size: 0.875rem;
          color: #0066cc;
          background: #e7f0ff;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
        }

        .slider-input {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: #ddd;
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }

        .slider-input:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .slider-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #0066cc;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .slider-input::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #0066cc;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .slider-input:disabled::-webkit-slider-thumb {
          background: #999;
          cursor: not-allowed;
        }

        .slider-input:disabled::-moz-range-thumb {
          background: #999;
          cursor: not-allowed;
        }

        .slider-description {
          font-size: 0.75rem;
          color: #666;
        }
      `}</style>
    </div>
  );
}

export default WeightSliders;
