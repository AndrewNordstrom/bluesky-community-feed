import { useState, useCallback, useEffect } from 'react';
import {
  DEFAULT_GOVERNANCE_WEIGHTS,
  GOVERNANCE_WEIGHT_KEYS,
  VOTABLE_WEIGHT_PARAMS,
  type GovernanceWeightKey,
  type GovernanceWeights,
} from '../config/votable-params';

/**
 * Weight configuration for the governance system.
 * All values must be 0.0-1.0 and sum to 1.0.
 */
export type { GovernanceWeights } from '../config/votable-params';

interface WeightSlidersProps {
  initialWeights?: GovernanceWeights;
  onChange?: (weights: GovernanceWeights) => void;
  disabled?: boolean;
}

const DEFAULT_WEIGHTS: GovernanceWeights = DEFAULT_GOVERNANCE_WEIGHTS;

const WEIGHT_LABELS = Object.fromEntries(
  VOTABLE_WEIGHT_PARAMS.map((param) => [
    param.key,
    {
      name: param.label,
      description: param.description,
    },
  ])
) as Record<GovernanceWeightKey, { name: string; description: string }>;

const WEIGHT_KEYS = [...GOVERNANCE_WEIGHT_KEYS];

/**
 * WeightSliders Component
 *
 * 5 linked sliders that always sum to 1.0.
 * When user drags one slider, others adjust proportionally.
 */
export function WeightSliders({ initialWeights, onChange, disabled = false }: WeightSlidersProps) {
  const [weights, setWeights] = useState<GovernanceWeights>(
    initialWeights ?? { ...DEFAULT_WEIGHTS }
  );

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
    (key: GovernanceWeightKey, newValue: number) => {
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
        <h3>Algorithm weights</h3>
        <div className={`sum-indicator ${isValid ? 'valid' : 'invalid'}`}>
          Total: {(sum * 100).toFixed(0)}%
          {isValid ? '' : ' (must equal 100%)'}
        </div>
      </div>

      <div className="sliders-container">
        {WEIGHT_KEYS.map((key) => {
          const { name, description } = WEIGHT_LABELS[key];
          const value = weights[key];
          const percentage = Math.round(value * 100);

          return (
            <div key={key} className="slider-row">
              <div className="slider-label">
                <span className="slider-name">{name}</span>
                <span className="slider-value">{percentage}%</span>
              </div>
              <div className="slider-track-container">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={percentage}
                  onChange={(e) => handleSliderChange(key, parseFloat(e.target.value) / 100)}
                  disabled={disabled}
                  className="slider-input"
                  aria-label={`${name} weight`}
                  style={{ '--slider-value': percentage } as React.CSSProperties}
                />
              </div>
              <div className="slider-description">{description}</div>
            </div>
          );
        })}
      </div>

      <style>{`
        .weight-sliders {
          padding: var(--space-6);
          border-radius: var(--radius-lg);
          background: var(--bg-elevated);
        }

        .sliders-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-6);
        }

        .sliders-header h3 {
          margin: 0;
          font-size: var(--text-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .sum-indicator {
          font-size: var(--text-sm);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          font-weight: var(--font-weight-medium);
        }

        .sum-indicator.valid {
          background: rgba(52, 199, 89, 0.15);
          color: var(--status-success);
        }

        .sum-indicator.invalid {
          background: rgba(255, 69, 58, 0.15);
          color: var(--status-error);
        }

        .sliders-container {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .slider-row {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .slider-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .slider-name {
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          font-size: var(--text-base);
        }

        .slider-value {
          font-size: var(--text-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--accent-blue);
          background: var(--accent-blue-subtle);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-md);
          min-width: 48px;
          text-align: center;
        }

        .slider-track-container {
          position: relative;
          height: 32px;
          display: flex;
          align-items: center;
        }

        .slider-input {
          width: 100%;
          height: 32px;
          background: transparent;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
          cursor: pointer;
          position: relative;
          margin: 0;
        }

        .slider-input:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        /* WebKit (Chrome, Safari, Edge) */
        .slider-input::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: var(--radius-full);
          background: linear-gradient(
            to right,
            var(--accent-blue) 0%,
            var(--accent-blue) calc(var(--slider-value) * 1%),
            var(--slider-track) calc(var(--slider-value) * 1%),
            var(--slider-track) 100%
          );
        }

        .slider-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--slider-thumb);
          cursor: pointer;
          border: 3px solid var(--accent-blue);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          margin-top: -7px;
        }

        .slider-input:hover::-webkit-slider-thumb {
          box-shadow: 0 2px 12px rgba(16, 131, 254, 0.5);
        }

        /* Firefox */
        .slider-input::-moz-range-track {
          height: 6px;
          border-radius: var(--radius-full);
          background: linear-gradient(
            to right,
            var(--accent-blue) 0%,
            var(--accent-blue) calc(var(--slider-value) * 1%),
            var(--slider-track) calc(var(--slider-value) * 1%),
            var(--slider-track) 100%
          );
        }

        .slider-input::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--slider-thumb);
          cursor: pointer;
          border: 3px solid var(--accent-blue);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }

        .slider-input:hover::-moz-range-thumb {
          box-shadow: 0 2px 12px rgba(16, 131, 254, 0.5);
        }

        .slider-input:disabled::-webkit-slider-thumb {
          background: var(--text-muted);
          border-color: var(--text-muted);
          cursor: not-allowed;
        }

        .slider-input:disabled::-moz-range-thumb {
          background: var(--text-muted);
          border-color: var(--text-muted);
          cursor: not-allowed;
        }

        .slider-description {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          line-height: var(--leading-relaxed);
        }
      `}</style>
    </div>
  );
}

export default WeightSliders;
