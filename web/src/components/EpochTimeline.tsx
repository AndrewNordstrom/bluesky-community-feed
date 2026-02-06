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

const WEIGHT_COLORS: Record<string, string> = {
  recency: '#667eea',
  engagement: '#764ba2',
  bridging: '#48bb78',
  sourceDiversity: '#ed8936',
  relevance: '#e53e3e',
};

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return '#48bb78';
      case 'voting':
        return '#667eea';
      case 'closed':
        return '#a0aec0';
      default:
        return '#e2e8f0';
    }
  };

  return (
    <div className="epoch-timeline">
      <div className="timeline-header">
        <h3>Epoch History</h3>
        <div className="weight-legend">
          {WEIGHT_KEYS.map((key) => (
            <span key={key} className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: WEIGHT_COLORS[key] }} />
              {key === 'sourceDiversity' ? 'Src Div' : key.charAt(0).toUpperCase() + key.slice(1)}
            </span>
          ))}
        </div>
      </div>

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
                <span className="status-dot" style={{ backgroundColor: getStatusColor(epoch.status) }} />
                Epoch #{epoch.id}
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
                      backgroundColor: WEIGHT_COLORS[key] || '#e2e8f0',
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

        .timeline-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .timeline-header h3 {
          margin: 0;
          font-size: 1.125rem;
          color: #1a1a2e;
        }

        .weight-legend {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.7rem;
          color: #666;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .timeline-container {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .epoch-card {
          position: relative;
          background: #f8f9fa;
          border-radius: 8px;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          border: 2px solid transparent;
        }

        .epoch-card:hover {
          background: #f0f1f3;
        }

        .epoch-card.selected {
          border-color: #667eea;
          background: #f0f4ff;
        }

        .epoch-card.active {
          border-left: 4px solid #48bb78;
        }

        .epoch-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .epoch-id {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
          color: #1a1a2e;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-badge {
          font-size: 0.7rem;
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
          text-transform: uppercase;
          font-weight: 600;
        }

        .status-badge.active {
          background: #c6f6d5;
          color: #22543d;
        }

        .status-badge.voting {
          background: #bee3f8;
          color: #2a4365;
        }

        .status-badge.closed {
          background: #e2e8f0;
          color: #4a5568;
        }

        .epoch-date {
          font-size: 0.75rem;
          color: #666;
          margin-bottom: 0.75rem;
        }

        .weight-bars {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .weight-bar-container {
          height: 4px;
          background: #e2e8f0;
          border-radius: 2px;
          overflow: hidden;
        }

        .weight-bar {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .epoch-stats {
          margin-top: 0.5rem;
          font-size: 0.75rem;
          color: #666;
        }

        .timeline-connector {
          position: absolute;
          left: 1.5rem;
          bottom: -0.5rem;
          width: 2px;
          height: 0.5rem;
          background: #e2e8f0;
        }

        @media (max-width: 500px) {
          .timeline-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  );
}

export default EpochTimeline;
