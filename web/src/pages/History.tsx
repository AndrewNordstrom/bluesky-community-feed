import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { EpochTimeline } from '../components/EpochTimeline';
import { ScoreRadar } from '../components/ScoreRadar';
import { transparencyApi } from '../api/client';
import type { EpochResponse, AuditLogEntry } from '../api/client';

export function History() {
  const [epochs, setEpochs] = useState<EpochResponse[]>([]);
  const [selectedEpoch, setSelectedEpoch] = useState<EpochResponse | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        const [epochsData, auditData] = await Promise.all([
          transparencyApi.getEpochHistory(),
          transparencyApi.getAuditLog({ limit: 50 }),
        ]);

        setEpochs(epochsData.epochs);
        setAuditLog(auditData.entries);

        // Select the current active epoch by default
        const active = epochsData.epochs.find((e) => e.status === 'active');
        if (active) {
          setSelectedEpoch(active);
        } else if (epochsData.epochs.length > 0) {
          setSelectedEpoch(epochsData.epochs[0]);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load history');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  const handleEpochClick = (epochId: number) => {
    const epoch = epochs.find((e) => e.id === epochId);
    if (epoch) {
      setSelectedEpoch(epoch);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAction = (action: string) => {
    return action
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Get audit entries for selected epoch
  const epochAuditEntries = selectedEpoch
    ? auditLog.filter((entry) => entry.epoch_id === selectedEpoch.id)
    : [];

  if (isLoading) {
    return (
      <div className="history-page">
        <div className="loading">Loading history...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="history-page">
        <div className="error-container">
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/dashboard" className="back-link">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="history-page">
      <header className="history-header">
        <div className="header-content">
          <h1>Governance History</h1>
          <nav className="header-nav">
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/vote">Vote</Link>
          </nav>
        </div>
      </header>

      <main className="history-main">
        <div className="history-layout">
          <aside className="timeline-sidebar">
            <EpochTimeline
              epochs={epochs.map((e) => ({
                id: e.id,
                status: e.status,
                weights: {
                  recency: e.weights.recency,
                  engagement: e.weights.engagement,
                  bridging: e.weights.bridging,
                  sourceDiversity: e.weights.source_diversity,
                  relevance: e.weights.relevance,
                },
                voteCount: e.vote_count,
                createdAt: e.created_at,
                closedAt: e.closed_at,
              }))}
              selectedEpochId={selectedEpoch?.id}
              onEpochClick={handleEpochClick}
            />
          </aside>

          <div className="epoch-details">
            {selectedEpoch && (
              <>
                <section className="epoch-overview">
                  <div className="epoch-header">
                    <h2>Epoch #{selectedEpoch.id}</h2>
                    <span className={`status-badge ${selectedEpoch.status}`}>
                      {selectedEpoch.status}
                    </span>
                  </div>
                  <div className="epoch-meta">
                    <span>Created: {formatDate(selectedEpoch.created_at)}</span>
                    {selectedEpoch.closed_at && (
                      <span>Closed: {formatDate(selectedEpoch.closed_at)}</span>
                    )}
                    <span>{selectedEpoch.vote_count} votes</span>
                  </div>
                  {selectedEpoch.description && (
                    <p className="epoch-description">{selectedEpoch.description}</p>
                  )}
                </section>

                <section className="weights-section">
                  <h3>Weight Distribution</h3>
                  <div className="weights-content">
                    <div className="radar-container">
                      <ScoreRadar
                        weights={{
                          recency: selectedEpoch.weights.recency,
                          engagement: selectedEpoch.weights.engagement,
                          bridging: selectedEpoch.weights.bridging,
                          sourceDiversity: selectedEpoch.weights.source_diversity,
                          relevance: selectedEpoch.weights.relevance,
                        }}
                        showWeights={true}
                        height={250}
                      />
                    </div>
                    <div className="weights-list">
                      {Object.entries(selectedEpoch.weights).map(([key, value]) => (
                        <div key={key} className="weight-row">
                          <span className="weight-name">
                            {key === 'source_diversity'
                              ? 'Source Diversity'
                              : key.charAt(0).toUpperCase() + key.slice(1)}
                          </span>
                          <span className="weight-value">{(value * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {epochAuditEntries.length > 0 && (
                  <section className="audit-section">
                    <h3>Activity Log</h3>
                    <div className="audit-list">
                      {epochAuditEntries.map((entry) => (
                        <div key={entry.id} className="audit-item">
                          <span className="audit-action">{formatAction(entry.action)}</span>
                          <span className="audit-time">{formatDate(entry.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>

        <section className="full-audit-section">
          <h2>Complete Audit Log</h2>
          <div className="audit-table-container">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Epoch</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatAction(entry.action)}</td>
                    <td>
                      {entry.epoch_id ? (
                        <button
                          className="epoch-link"
                          onClick={() => entry.epoch_id && handleEpochClick(entry.epoch_id)}
                        >
                          #{entry.epoch_id}
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{formatDate(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <style>{`
        .history-page {
          min-height: 100vh;
          background: #f5f5f5;
        }

        .loading, .error-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          gap: 1rem;
        }

        .history-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1rem;
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .history-header h1 {
          margin: 0;
          font-size: 1.5rem;
        }

        .header-nav {
          display: flex;
          gap: 1rem;
        }

        .header-nav a {
          color: white;
          text-decoration: none;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.1);
          transition: background 0.2s;
        }

        .header-nav a:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .history-main {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }

        .history-layout {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .timeline-sidebar {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          max-height: 600px;
          overflow-y: auto;
        }

        .epoch-details {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .epoch-details section {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .epoch-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .epoch-header h2 {
          margin: 0;
          font-size: 1.25rem;
          color: #1a1a2e;
        }

        .status-badge {
          font-size: 0.75rem;
          padding: 0.25rem 0.75rem;
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

        .epoch-meta {
          display: flex;
          gap: 1.5rem;
          font-size: 0.875rem;
          color: #666;
          flex-wrap: wrap;
        }

        .epoch-description {
          margin-top: 1rem;
          color: #4a5568;
          line-height: 1.5;
        }

        .weights-section h3, .audit-section h3 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
          color: #1a1a2e;
        }

        .weights-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          align-items: center;
        }

        .weights-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .weight-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem;
          background: #f8f9fa;
          border-radius: 4px;
        }

        .weight-name {
          font-size: 0.875rem;
          color: #1a1a2e;
        }

        .weight-value {
          font-family: monospace;
          color: #667eea;
          font-weight: 600;
        }

        .audit-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .audit-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem;
          background: #f8f9fa;
          border-radius: 4px;
          font-size: 0.875rem;
        }

        .audit-action {
          color: #1a1a2e;
        }

        .audit-time {
          color: #666;
        }

        .full-audit-section {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .full-audit-section h2 {
          margin: 0 0 1rem 0;
          font-size: 1.125rem;
          color: #1a1a2e;
        }

        .audit-table-container {
          overflow-x: auto;
        }

        .audit-table {
          width: 100%;
          border-collapse: collapse;
        }

        .audit-table th, .audit-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }

        .audit-table th {
          font-size: 0.75rem;
          color: #666;
          font-weight: 600;
          text-transform: uppercase;
        }

        .epoch-link {
          background: #e7f0ff;
          color: #667eea;
          border: none;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
        }

        .epoch-link:hover {
          background: #d1e3ff;
        }

        @media (max-width: 900px) {
          .history-layout {
            grid-template-columns: 1fr;
          }

          .timeline-sidebar {
            max-height: none;
          }

          .weights-content {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

export default History;
