interface EpochData {
  id: number;
  status: string;
  weights: {
    recency: number;
    engagement: number;
    bridging: number;
    sourceDiversity: number;
    relevance: number;
  };
  voteCount: number;
  createdAt: string;
  closedAt?: string;
}

interface EpochTimelineProps {
  epochs: EpochData[];
  onEpochClick?: (epochId: number) => void;
  selectedEpochId?: number;
}

const WEIGHT_KEYS = ['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'] as const;

/**
 * EpochTimeline Component
 *
 * Visual timeline showing governance epochs with weight distributions.
 */
export function EpochTimeline({ epochs, onEpochClick, selectedEpochId }: EpochTimelineProps) {
  const sortedEpochs = [...epochs].sort((a, b) => b.id - a.id);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="epoch-timeline">
      <div className="timeline-container">
        {sortedEpochs.map((epoch, index) => (
          <div
            key={epoch.id}
            className={`epoch-card ${selectedEpochId === epoch.id ? 'selected' : ''} ${
              epoch.status === 'active' ? 'active' : ''
            }`}
            onClick={() => onEpochClick?.(epoch.id)}
          >
            <div className="epoch-header">
              <div className="epoch-id">
                <span className={`status-dot ${epoch.status}`} />
                Epoch {epoch.id}
              </div>
              <span className={`status-badge ${epoch.status}`}>{epoch.status}</span>
            </div>

            <div className="epoch-date">{formatDate(epoch.createdAt)}</div>

            <div className="weight-bars">
              {WEIGHT_KEYS.map((key) => (
                <div key={key} className="weight-bar-container">
                  <div
                    className="weight-bar"
                    style={{
                      width: `${(epoch.weights[key] || 0) * 100}%`,
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="epoch-stats">
              <span className="stat">{epoch.voteCount} votes</span>
            </div>

            {index < sortedEpochs.length - 1 && <div className="timeline-connector" />}
          </div>
        ))}
      </div>

      <style>{`
        .epoch-timeline {
          width: 100%;
        }

        .timeline-container {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .epoch-card {
          position: relative;
          background: var(--bg-elevated);
          border-radius: var(--radius-md);
          padding: var(--space-4);
          cursor: pointer;
          transition: all var(--transition-fast);
          border: 1px solid transparent;
        }

        .epoch-card:hover {
          background: var(--bg-hover);
        }

        .epoch-card.selected {
          border-color: var(--accent-blue);
          background: var(--accent-blue-subtle);
        }

        .epoch-card.active {
          border-left: 3px solid var(--status-success);
        }

        .epoch-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-2);
        }

        .epoch-id {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          font-size: var(--text-sm);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-muted);
        }

        .status-dot.active {
          background: var(--status-success);
        }

        .status-dot.voting {
          background: var(--accent-blue);
        }

        .status-dot.closed {
          background: var(--text-muted);
        }

        .status-badge {
          font-size: var(--text-xs);
          padding: 2px var(--space-2);
          border-radius: var(--radius-full);
          font-weight: var(--font-weight-medium);
        }

        .status-badge.active {
          background: rgba(52, 199, 89, 0.15);
          color: var(--status-success);
        }

        .status-badge.voting {
          background: var(--accent-blue-subtle);
          color: var(--accent-blue);
        }

        .status-badge.closed {
          background: var(--bg-card);
          color: var(--text-secondary);
        }

        .epoch-date {
          font-size: var(--text-xs);
          color: var(--text-secondary);
          margin-bottom: var(--space-3);
        }

        .weight-bars {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .weight-bar-container {
          height: 4px;
          background: var(--border-default);
          border-radius: var(--radius-full);
          overflow: hidden;
        }

        .weight-bar {
          height: 100%;
          background: var(--accent-blue);
          border-radius: var(--radius-full);
          transition: width var(--transition-base);
        }

        .epoch-stats {
          margin-top: var(--space-3);
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }

        .timeline-connector {
          position: absolute;
          left: var(--space-5);
          bottom: calc(-1 * var(--space-2));
          width: 2px;
          height: var(--space-2);
          background: var(--border-default);
        }
      `}</style>
    </div>
  );
}

export default EpochTimeline;
