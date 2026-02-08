import { useMemo, useState } from 'react';
import { adminApi, type RoundDetails, type RoundSummary } from '../../api/admin';
import { formatDate } from '../../utils/format';

interface RoundHistoryCardProps {
  rounds: RoundSummary[];
}

function formatDurationWindow(startedAt: string, endedAt: string | null): string {
  const start = formatDate(startedAt);
  const end = endedAt ? formatDate(endedAt) : 'now';
  return `${start} -> ${end}`;
}

function formatChange(current: number, previous: number): string {
  const delta = Math.round((current - previous) * 100);
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta}%`;
}

export function RoundHistoryCard({ rounds }: RoundHistoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<RoundDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const visibleRounds = useMemo(() => {
    if (!isExpanded) {
      return rounds.slice(0, 3);
    }

    if (showAll) {
      return rounds;
    }

    return rounds.slice(0, 3);
  }, [rounds, isExpanded, showAll]);

  async function handleViewDetails(roundId: number) {
    setSelectedRoundId(roundId);
    setIsLoadingDetails(true);

    try {
      const details = await adminApi.getRoundDetails(roundId);
      setSelectedDetails(details);
    } catch {
      setSelectedDetails(null);
    } finally {
      setIsLoadingDetails(false);
    }
  }

  return (
    <>
      <div className="admin-card">
        <div className="round-history-header">
          <h2>Round History</h2>
          <button
            type="button"
            className="changes-link"
            onClick={() => {
              setIsExpanded(!isExpanded);
              if (isExpanded) {
                setShowAll(false);
              }
            }}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        <table className="admin-table round-history-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Status</th>
              <th>Votes</th>
              <th>Duration</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {visibleRounds.map((round) => (
              <tr key={round.id}>
                <td>#{round.id}</td>
                <td>
                  <span className={`status-badge ${round.status === 'closed' ? 'closed' : 'open'}`}>
                    {round.status}
                  </span>
                </td>
                <td>{round.voteCount}</td>
                <td>{formatDurationWindow(round.createdAt, round.closedAt)}</td>
                <td>
                  <button
                    type="button"
                    className="changes-link"
                    onClick={() => void handleViewDetails(round.id)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isExpanded && rounds.length > 3 && !showAll ? (
          <div className="action-buttons">
            <button type="button" className="btn-secondary" onClick={() => setShowAll(true)}>
              Show all
            </button>
          </div>
        ) : null}
      </div>

      {selectedRoundId !== null ? (
        <div className="modal-overlay" role="presentation" onClick={() => setSelectedRoundId(null)}>
          <div className="modal-content modal-content-wide" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">Round {selectedRoundId} Changes</h3>

            {isLoadingDetails ? (
              <p className="modal-message">Loading round details...</p>
            ) : !selectedDetails ? (
              <p className="modal-message">Failed to load round details.</p>
            ) : (
              <div className="round-detail-grid">
                <div>
                  <h4>Weight Changes</h4>
                  <div className="stat-row">
                    <span>Recency</span>
                    <strong>{formatChange(selectedDetails.endingWeights.recency, selectedDetails.startingWeights.recency)}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Engagement</span>
                    <strong>
                      {formatChange(selectedDetails.endingWeights.engagement, selectedDetails.startingWeights.engagement)}
                    </strong>
                  </div>
                  <div className="stat-row">
                    <span>Bridging</span>
                    <strong>{formatChange(selectedDetails.endingWeights.bridging, selectedDetails.startingWeights.bridging)}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Source Diversity</span>
                    <strong>
                      {formatChange(
                        selectedDetails.endingWeights.sourceDiversity,
                        selectedDetails.startingWeights.sourceDiversity
                      )}
                    </strong>
                  </div>
                  <div className="stat-row">
                    <span>Relevance</span>
                    <strong>{formatChange(selectedDetails.endingWeights.relevance, selectedDetails.startingWeights.relevance)}</strong>
                  </div>
                </div>

                <div>
                  <h4>Rule Changes</h4>
                  <div className="keyword-section">
                    <label>Started with include:</label>
                    <div className="keyword-pills">
                      {selectedDetails.startingRules.includeKeywords.length > 0
                        ? selectedDetails.startingRules.includeKeywords.map((keyword) => (
                            <span className="pill pill-include" key={`start-include-${keyword}`}>
                              {keyword}
                            </span>
                          ))
                        : <span className="no-rules">None</span>}
                    </div>
                  </div>
                  <div className="keyword-section">
                    <label>Ended with include:</label>
                    <div className="keyword-pills">
                      {selectedDetails.endingRules.includeKeywords.length > 0
                        ? selectedDetails.endingRules.includeKeywords.map((keyword) => (
                            <span className="pill pill-include" key={`end-include-${keyword}`}>
                              {keyword}
                            </span>
                          ))
                        : <span className="no-rules">None</span>}
                    </div>
                  </div>
                  <div className="keyword-section">
                    <label>Started with exclude:</label>
                    <div className="keyword-pills">
                      {selectedDetails.startingRules.excludeKeywords.length > 0
                        ? selectedDetails.startingRules.excludeKeywords.map((keyword) => (
                            <span className="pill pill-exclude" key={`start-exclude-${keyword}`}>
                              {keyword}
                            </span>
                          ))
                        : <span className="no-rules">None</span>}
                    </div>
                  </div>
                  <div className="keyword-section">
                    <label>Ended with exclude:</label>
                    <div className="keyword-pills">
                      {selectedDetails.endingRules.excludeKeywords.length > 0
                        ? selectedDetails.endingRules.excludeKeywords.map((keyword) => (
                            <span className="pill pill-exclude" key={`end-exclude-${keyword}`}>
                              {keyword}
                            </span>
                          ))
                        : <span className="no-rules">None</span>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelectedRoundId(null);
                  setSelectedDetails(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
