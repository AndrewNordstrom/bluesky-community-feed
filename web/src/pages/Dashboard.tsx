import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ScoreRadar } from '../components/ScoreRadar';
import { transparencyApi } from '../api/client';
import type { FeedStatsResponse, AuditLogEntry } from '../api/client';

export function Dashboard() {
  const [stats, setStats] = useState<FeedStatsResponse | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        const [statsData, auditData] = await Promise.all([
          transparencyApi.getStats(),
          transparencyApi.getAuditLog({ limit: 5 }),
        ]);

        setStats(statsData);
        setAuditLog(auditData.entries);
      } catch (err: any) {
        setError(err.message || 'Failed to load dashboard data');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
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

  if (isLoading) {
    return (
      <div className="dashboard-page">
        <div className="loading">
          <div className="loading-spinner" />
          <span>Loading dashboard...</span>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="error-container">
          <h2>Error loading dashboard</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="retry-button">
            Retry
          </button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Community feed</h1>
            <nav className="header-nav">
              <Link to="/vote" className="nav-link">Vote</Link>
              <Link to="/dashboard" className="nav-link active">Dashboard</Link>
              <Link to="/history" className="nav-link">History</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        {stats && (
          <>
            <section className="weights-section">
              <div className="section-header">
                <h2>Current algorithm weights</h2>
                <span className="epoch-badge">Epoch {stats.epoch.id}</span>
              </div>
              <div className="weights-content">
                <div className="radar-container">
                  <ScoreRadar
                    weights={{
                      recency: stats.epoch.weights.recency,
                      engagement: stats.epoch.weights.engagement,
                      bridging: stats.epoch.weights.bridging,
                      sourceDiversity: stats.epoch.weights.source_diversity,
                      relevance: stats.epoch.weights.relevance,
                    }}
                    showWeights={true}
                    height={280}
                  />
                </div>
                <div className="weights-list">
                  {Object.entries(stats.epoch.weights).map(([key, value]) => (
                    <div key={key} className="weight-item">
                      <span className="weight-name">
                        {key === 'source_diversity' ? 'Source diversity' : key.charAt(0).toUpperCase() + key.slice(1)}
                      </span>
                      <div className="weight-bar-container">
                        <div
                          className="weight-bar"
                          style={{ width: `${value * 100}%` }}
                        />
                      </div>
                      <span className="weight-value">{(value * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="stats-section">
              <h2>Feed statistics</h2>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{stats.feed_stats.total_posts_scored.toLocaleString()}</span>
                  <span className="stat-label">Posts scored</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.feed_stats.unique_authors.toLocaleString()}</span>
                  <span className="stat-label">Unique authors</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{(stats.feed_stats.avg_bridging_score * 100).toFixed(1)}%</span>
                  <span className="stat-label">Avg bridging</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.governance.votes_this_epoch}</span>
                  <span className="stat-label">Votes this epoch</span>
                </div>
                {stats.metrics?.author_gini !== null && stats.metrics?.author_gini !== undefined && (
                  <div className="stat-card">
                    <span className="stat-value">{(stats.metrics.author_gini * 100).toFixed(1)}%</span>
                    <span className="stat-label">Author concentration</span>
                  </div>
                )}
              </div>
            </section>

            <section className="audit-section">
              <div className="section-header">
                <h2>Recent governance activity</h2>
                <Link to="/history" className="view-all-link">View all</Link>
              </div>
              <div className="audit-list">
                {auditLog.length === 0 ? (
                  <p className="no-activity">No governance activity yet</p>
                ) : (
                  auditLog.map((entry) => (
                    <div key={entry.id} className="audit-item">
                      <div className="audit-action">{formatAction(entry.action)}</div>
                      <div className="audit-meta">
                        <span className="audit-time">{formatDate(entry.created_at)}</span>
                        {entry.epoch_id && (
                          <span className="audit-epoch">Epoch {entry.epoch_id}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .dashboard-page {
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

  .error-container p {
    color: var(--text-secondary);
  }

  .retry-button {
    background: var(--accent-blue);
    color: white;
    border: none;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-weight: var(--font-weight-semibold);
  }

  .retry-button:hover {
    background: var(--accent-blue-hover);
  }

  .dashboard-header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-default);
    padding: var(--space-4) var(--space-6);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-content {
    max-width: 1000px;
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

  .dashboard-header h1 {
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

  .dashboard-main {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-5);
  }

  section h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .epoch-badge {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-semibold);
  }

  .weights-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    align-items: center;
  }

  .radar-container {
    min-height: 280px;
  }

  .weights-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .weight-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .weight-name {
    min-width: 120px;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .weight-bar-container {
    flex: 1;
    height: 6px;
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

  .weight-value {
    min-width: 40px;
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--accent-blue);
    text-align: right;
  }

  .stats-section h2 {
    margin-bottom: var(--space-5);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-4);
  }

  .stat-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .stat-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-top: var(--space-2);
  }

  .view-all-link {
    color: var(--accent-blue);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
  }

  .view-all-link:hover {
    color: var(--accent-blue-hover);
  }

  .audit-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .no-activity {
    color: var(--text-secondary);
    text-align: center;
    padding: var(--space-6);
  }

  .audit-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
  }

  .audit-action {
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .audit-meta {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .audit-epoch {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-weight: var(--font-weight-medium);
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

    .dashboard-main {
      padding: var(--space-4);
    }

    .weights-content {
      grid-template-columns: 1fr;
    }

    .audit-item {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
    }
  }
`;

export default Dashboard;
