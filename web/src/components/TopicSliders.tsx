import type { TopicCatalogEntry } from '../api/client';

interface TopicSlidersProps {
  topics: TopicCatalogEntry[];
  values: Record<string, number>;
  onChange: (slug: string, value: number) => void;
  onReset: () => void;
  touchedSlugs: Set<string>;
  disabled?: boolean;
}

/** Prettify a slug into a display name: "software-development" → "Software Development" */
function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * TopicSliders Component
 *
 * Independent topic preference sliders (0.0–1.0 each, NOT linked).
 * Color-coded: red (penalize) → grey (neutral) → green (boost).
 * Groups topics by parentSlug when available.
 */
export function TopicSliders({
  topics,
  values,
  onChange,
  onReset,
  touchedSlugs,
  disabled = false,
}: TopicSlidersProps) {
  const touchedCount = touchedSlugs.size;
  const totalCount = topics.length;

  // Group topics by parentSlug
  const groups = new Map<string | null, TopicCatalogEntry[]>();
  for (const topic of topics) {
    const group = topic.parentSlug;
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(topic);
  }

  // Sort groups: null (ungrouped) first, then alphabetically
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    if (a[0] === null && b[0] !== null) return -1;
    if (a[0] !== null && b[0] === null) return 1;
    return (a[0] ?? '').localeCompare(b[0] ?? '');
  });

  return (
    <div className="topic-sliders">
      <div className="topic-sliders-header">
        <div className="topic-sliders-info">
          <span className="adjusted-count">
            {touchedCount} of {totalCount} topics adjusted
          </span>
        </div>
        <button
          className="reset-button"
          onClick={onReset}
          disabled={disabled || touchedCount === 0}
          type="button"
        >
          Reset all to neutral
        </button>
      </div>

      <div className="topic-groups">
        {sortedGroups.map(([groupSlug, groupTopics]) => (
          <div key={groupSlug ?? '__ungrouped'} className="topic-group">
            {groupSlug && (
              <h4 className="topic-group-heading">{prettifySlug(groupSlug)}</h4>
            )}
            <div className="topic-list">
              {groupTopics.map((topic) => {
                const value = values[topic.slug] ?? 0.5;
                const isTouched = touchedSlugs.has(topic.slug);
                const percentage = Math.round(value * 100);
                const communityPct = Math.round(topic.currentWeight * 100);

                return (
                  <div
                    key={topic.slug}
                    className={`topic-slider-row ${isTouched ? 'touched' : 'untouched'}`}
                  >
                    <div className="topic-slider-label">
                      <span className="topic-name">{topic.name}</span>
                      <span className={`topic-value ${value < 0.3 ? 'penalize' : value > 0.7 ? 'boost' : 'neutral'}`}>
                        {percentage}%
                      </span>
                    </div>
                    <div className="topic-slider-track-container">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={percentage}
                        onChange={(e) =>
                          onChange(topic.slug, parseFloat(e.target.value) / 100)
                        }
                        disabled={disabled}
                        className="topic-slider-input"
                        aria-label={`${topic.name} preference`}
                        style={
                          {
                            '--topic-slider-value': percentage,
                          } as React.CSSProperties
                        }
                      />
                      {/* Community average marker */}
                      <div
                        className="community-marker"
                        style={{ left: `${communityPct}%` }}
                        title={`Community average: ${communityPct}%`}
                      />
                    </div>
                    {topic.description && (
                      <div className="topic-description">{topic.description}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .topic-sliders {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .topic-sliders-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: var(--space-3);
          border-bottom: 1px solid var(--border-default);
        }

        .adjusted-count {
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .reset-button {
          background: transparent;
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
          padding: var(--space-2) var(--space-4);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: var(--font-weight-medium);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .reset-button:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: var(--border-subtle);
          color: var(--text-primary);
        }

        .reset-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .topic-groups {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .topic-group-heading {
          margin: 0 0 var(--space-3) 0;
          font-size: var(--text-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .topic-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .topic-slider-row {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          transition: opacity var(--transition-fast);
        }

        .topic-slider-row.untouched {
          opacity: 0.6;
        }

        .topic-slider-row.untouched:hover,
        .topic-slider-row.untouched:focus-within {
          opacity: 1;
        }

        .topic-slider-row.touched {
          opacity: 1;
        }

        .topic-slider-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .topic-name {
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          font-size: var(--text-base);
        }

        .topic-value {
          font-size: var(--text-sm);
          font-weight: var(--font-weight-semibold);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-md);
          min-width: 48px;
          text-align: center;
        }

        .topic-value.penalize {
          background: rgba(255, 69, 58, 0.15);
          color: var(--status-error);
        }

        .topic-value.neutral {
          background: var(--bg-elevated);
          color: var(--text-secondary);
        }

        .topic-value.boost {
          background: rgba(52, 199, 89, 0.15);
          color: var(--status-success);
        }

        .topic-slider-track-container {
          position: relative;
          height: 32px;
          display: flex;
          align-items: center;
        }

        .topic-slider-input {
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

        .topic-slider-input:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        /* WebKit track: red → grey → green gradient */
        .topic-slider-input::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: var(--radius-full);
          background: linear-gradient(
            to right,
            rgba(255, 69, 58, 0.6) 0%,
            rgba(255, 69, 58, 0.3) 15%,
            var(--border-default) 30%,
            var(--border-default) 70%,
            rgba(52, 199, 89, 0.3) 85%,
            rgba(52, 199, 89, 0.6) 100%
          );
        }

        .topic-slider-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--slider-thumb);
          cursor: pointer;
          border: 3px solid var(--text-secondary);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          margin-top: -7px;
          transition: border-color var(--transition-fast);
        }

        .topic-slider-row.touched .topic-slider-input::-webkit-slider-thumb {
          border-color: var(--accent-blue);
        }

        .topic-slider-input:hover::-webkit-slider-thumb {
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
        }

        /* Firefox track */
        .topic-slider-input::-moz-range-track {
          height: 6px;
          border-radius: var(--radius-full);
          background: linear-gradient(
            to right,
            rgba(255, 69, 58, 0.6) 0%,
            rgba(255, 69, 58, 0.3) 15%,
            var(--border-default) 30%,
            var(--border-default) 70%,
            rgba(52, 199, 89, 0.3) 85%,
            rgba(52, 199, 89, 0.6) 100%
          );
        }

        .topic-slider-input::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--slider-thumb);
          cursor: pointer;
          border: 3px solid var(--text-secondary);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }

        .topic-slider-row.touched .topic-slider-input::-moz-range-thumb {
          border-color: var(--accent-blue);
        }

        .topic-slider-input:disabled::-webkit-slider-thumb {
          background: var(--text-muted);
          border-color: var(--text-muted);
          cursor: not-allowed;
        }

        .topic-slider-input:disabled::-moz-range-thumb {
          background: var(--text-muted);
          border-color: var(--text-muted);
          cursor: not-allowed;
        }

        /* Community average marker */
        .community-marker {
          position: absolute;
          width: 2px;
          height: 14px;
          background: var(--accent-blue);
          opacity: 0.6;
          border-radius: 1px;
          pointer-events: none;
          top: 50%;
          transform: translate(-50%, -50%);
        }

        .topic-description {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          line-height: var(--leading-relaxed);
        }
      `}</style>
    </div>
  );
}

export default TopicSliders;
