import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EpochTimeline } from '../components/EpochTimeline';
import { ScoreRadar } from '../components/ScoreRadar';
import { HistorySkeleton } from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { transparencyApi } from '../api/client';
import type { EpochResponse, AuditLogEntry } from '../api/client';

interface RoundWeightChange {
  key: keyof EpochResponse['weights'];
  previous: number;
  current: number;
  delta: number;
}

interface RoundKeywordDiff {
  includeAdded: string[];
  includeRemoved: string[];
  excludeAdded: string[];
  excludeRemoved: string[];
}

interface RoundDiff {
  weightChanges: RoundWeightChange[];
  keywordDiff: RoundKeywordDiff;
}

const WEIGHT_LABELS: Record<keyof EpochResponse['weights'], string> = {
  recency: 'Recency',
  engagement: 'Engagement',
  bridging: 'Bridging',
  source_diversity: 'Source diversity',
  relevance: 'Relevance',
};

const ROUND_DIFF_EPSILON = 0.0005;

function normalizeKeywords(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))
  );
}

function computeRoundDiff(current: EpochResponse, previous: EpochResponse): RoundDiff {
  const weightChanges = (Object.keys(current.weights) as Array<keyof EpochResponse['weights']>)
    .map((key) => {
      const currentValue = current.weights[key];
      const previousValue = previous.weights[key];
      const delta = currentValue - previousValue;
      return {
        key,
        previous: previousValue,
        current: currentValue,
        delta,
      };
    })
    .filter((change) => Math.abs(change.delta) >= ROUND_DIFF_EPSILON);

  const currentRules = current.content_rules ?? { include_keywords: [], exclude_keywords: [] };
  const previousRules = previous.content_rules ?? { include_keywords: [], exclude_keywords: [] };

  const includeCurrent = normalizeKeywords(currentRules.include_keywords);
  const includePrevious = normalizeKeywords(previousRules.include_keywords);
  const includeCurrentSet = new Set(includeCurrent);
  const includePreviousSet = new Set(includePrevious);

  const excludeCurrent = normalizeKeywords(currentRules.exclude_keywords);
  const excludePrevious = normalizeKeywords(previousRules.exclude_keywords);
  const excludeCurrentSet = new Set(excludeCurrent);
  const excludePreviousSet = new Set(excludePrevious);

  return {
    weightChanges,
    keywordDiff: {
      includeAdded: includeCurrent.filter((keyword) => !includePreviousSet.has(keyword)),
      includeRemoved: includePrevious.filter((keyword) => !includeCurrentSet.has(keyword)),
      excludeAdded: excludeCurrent.filter((keyword) => !excludePreviousSet.has(keyword)),
      excludeRemoved: excludePrevious.filter((keyword) => !excludeCurrentSet.has(keyword)),
    },
  };
}

export function History() {
  const { userHandle, logout } = useAuth();
  const { isAdmin } = useAdminStatus();
  const navigate = useNavigate();
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
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Get audit entries for selected epoch
  const epochAuditEntries = selectedEpoch
    ? auditLog.filter((entry) => entry.epoch_id === selectedEpoch.id)
    : [];
  const sortedEpochs = [...epochs].sort((a, b) => b.id - a.id);
  const selectedIndex = selectedEpoch
    ? sortedEpochs.findIndex((epoch) => epoch.id === selectedEpoch.id)
    : -1;
  const previousEpoch = selectedIndex >= 0 ? (sortedEpochs[selectedIndex + 1] ?? null) : null;
  const roundDiff = selectedEpoch && previousEpoch
    ? computeRoundDiff(selectedEpoch, previousEpoch)
    : null;

  if (isLoading) {
    return (
      <div className="history-page">
        <header className="history-header">
          <div className="header-content">
            <div className="header-left">
              <h1>Community feed</h1>
              <nav className="header-nav">
                <Link to="/vote" className="nav-link">Vote</Link>
                <Link to="/dashboard" className="nav-link">Dashboard</Link>
                <Link to="/history" className="nav-link active">History</Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="history-main">
          <HistorySkeleton />
        </main>
        <style>{styles}</style>
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
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="history-page">
      <header className="history-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Community feed</h1>
            <nav className="header-nav">
              <Link to="/vote" className="nav-link">Vote</Link>
              <Link to="/dashboard" className="nav-link">Dashboard</Link>
              <Link to="/history" className="nav-link">History</Link>
              {isAdmin && <Link to="/admin" className="nav-link">Admin</Link>}
            </nav>
          </div>
          <div className="user-info">
            <span className="user-handle">@{userHandle}</span>
            <button onClick={handleLogout} className="logout-button">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="history-main page-content">
        <div className="history-layout">
          <aside className="timeline-sidebar">
            <h2>Rounds</h2>
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
                    <h2>Round {selectedEpoch.id}</h2>
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
                  <h3>Weight distribution</h3>
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
                              ? 'Source diversity'
                              : key.charAt(0).toUpperCase() + key.slice(1)}
                          </span>
                          <span className="weight-value">{(value * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {roundDiff && (
                  <section className="changes-section">
                    <h3>Changes from Round {previousEpoch?.id}</h3>
                    {roundDiff.weightChanges.length > 0 ? (
                      <div className="changes-list">
                        {roundDiff.weightChanges.map((change) => (
                          <div key={change.key} className="change-item">
                            <span>{WEIGHT_LABELS[change.key]}</span>
                            <strong>
                              {(change.previous * 100).toFixed(1)}% → {(change.current * 100).toFixed(1)}%
                              {' '}
                              ({change.delta >= 0 ? '+' : ''}{(change.delta * 100).toFixed(1)}%)
                            </strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="changes-empty">No weight changes from the prior round.</p>
                    )}
                    {(roundDiff.keywordDiff.includeAdded.length > 0 ||
                      roundDiff.keywordDiff.includeRemoved.length > 0 ||
                      roundDiff.keywordDiff.excludeAdded.length > 0 ||
                      roundDiff.keywordDiff.excludeRemoved.length > 0) && (
                      <div className="changes-keywords">
                        {roundDiff.keywordDiff.includeAdded.length > 0 && (
                          <p><strong>Include added:</strong> {roundDiff.keywordDiff.includeAdded.join(', ')}</p>
                        )}
                        {roundDiff.keywordDiff.includeRemoved.length > 0 && (
                          <p><strong>Include removed:</strong> {roundDiff.keywordDiff.includeRemoved.join(', ')}</p>
                        )}
                        {roundDiff.keywordDiff.excludeAdded.length > 0 && (
                          <p><strong>Exclude added:</strong> {roundDiff.keywordDiff.excludeAdded.join(', ')}</p>
                        )}
                        {roundDiff.keywordDiff.excludeRemoved.length > 0 && (
                          <p><strong>Exclude removed:</strong> {roundDiff.keywordDiff.excludeRemoved.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {epochAuditEntries.length > 0 && (
                  <section className="audit-section">
                    <h3>Activity log</h3>
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
          <h2>Complete audit log</h2>
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
                          {entry.epoch_id}
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

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .history-page {
    min-height: 100vh;
    background: var(--bg-app);
  }

  .loading, .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: var(--space-4);
    color: var(--text-secondary);
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-default);
    border-top-color: var(--accent-blue);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-container h2 {
    color: var(--text-primary);
    margin: 0;
  }

  .back-link {
    color: var(--accent-blue);
    font-weight: var(--font-weight-medium);
  }

  .history-header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-default);
    padding: var(--space-4) var(--space-6);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-content {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .history-header h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .header-nav {
    display: flex;
    gap: var(--space-1);
  }

  .nav-link {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    transition: all var(--transition-fast);
  }

  .nav-link:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .nav-link.active {
    color: var(--accent-blue);
    background: var(--accent-blue-subtle);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .user-handle {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .logout-button {
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

  .logout-button:hover {
    background: var(--bg-hover);
    border-color: var(--border-subtle);
    color: var(--text-primary);
  }

  .history-main {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  .history-layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .timeline-sidebar {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    max-height: 600px;
    overflow-y: auto;
  }

  .timeline-sidebar h2 {
    margin: 0 0 var(--space-4) 0;
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .epoch-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .epoch-details section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  .epoch-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
  }

  .epoch-header h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .status-badge {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-weight: var(--font-weight-semibold);
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
    background: var(--bg-elevated);
    color: var(--text-secondary);
  }

  .epoch-meta {
    display: flex;
    gap: var(--space-5);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    flex-wrap: wrap;
  }

  .epoch-description {
    margin-top: var(--space-4);
    color: var(--text-secondary);
    line-height: var(--leading-relaxed);
  }

  .weights-section h3, .audit-section h3 {
    margin: 0 0 var(--space-4) 0;
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .changes-section h3 {
    margin: 0 0 var(--space-4) 0;
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .changes-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .change-item {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .change-item strong {
    color: var(--accent-blue);
    font-variant-numeric: tabular-nums;
  }

  .changes-keywords p {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: var(--leading-relaxed);
    word-break: break-word;
  }

  .changes-keywords p:last-child {
    margin-bottom: 0;
  }

  .changes-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .weights-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-6);
    align-items: center;
  }

  .radar-container {
    min-height: 250px;
  }

  .weights-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .weight-row {
    display: flex;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
  }

  .weight-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .weight-value {
    font-weight: var(--font-weight-semibold);
    color: var(--accent-blue);
  }

  .audit-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .audit-item {
    display: flex;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .audit-action {
    color: var(--text-primary);
  }

  .audit-time {
    color: var(--text-secondary);
  }

  .full-audit-section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  .full-audit-section h2 {
    margin: 0 0 var(--space-5) 0;
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .audit-table-container {
    overflow-x: auto;
  }

  .audit-table {
    width: 100%;
    border-collapse: collapse;
  }

  .audit-table th, .audit-table td {
    padding: var(--space-4);
    text-align: left;
    border-bottom: 1px solid var(--border-default);
  }

  .audit-table th {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: var(--font-weight-semibold);
  }

  .audit-table td {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .epoch-link {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
    border: none;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    transition: background var(--transition-fast);
  }

  .epoch-link:hover {
    background: rgba(16, 131, 254, 0.25);
  }

  @media (max-width: 768px) {
    .header-content {
      flex-direction: column;
      gap: var(--space-4);
    }

    .header-left {
      flex-direction: column;
      gap: var(--space-4);
    }

    .history-main {
      padding: var(--space-4);
    }

    .history-layout {
      grid-template-columns: 1fr;
    }

    .timeline-sidebar {
      max-height: none;
    }

    .weights-content {
      grid-template-columns: 1fr;
    }

    .change-item {
      flex-direction: column;
      gap: var(--space-1);
    }
  }
`;

export default History;
