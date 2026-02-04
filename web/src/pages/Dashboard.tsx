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
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (isLoading) {
    return (
      <div className="dashboard-page">
        <div className="loading">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="error-container">
          <h2>Error Loading Dashboard</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>Feed Transparency Dashboard</h1>
          <nav className="header-nav">
            <Link to="/vote">Vote</Link>
            <Link to="/history">History</Link>
          </nav>
        </div>
      </header>

      <main className="dashboard-main">
        {stats && (
          <>
            <section className="weights-section">
              <div className="section-header">
                <h2>Current Algorithm Weights</h2>
                <span className="epoch-badge">Epoch #{stats.epoch.id}</span>
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
                        {key === 'source_diversity' ? 'Source Diversity' : key.charAt(0).toUpperCase() + key.slice(1)}
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
              <h2>Feed Statistics</h2>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{stats.feed_stats.total_posts_scored.toLocaleString()}</span>
                  <span className="stat-label">Posts Scored</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.feed_stats.unique_authors.toLocaleString()}</span>
                  <span className="stat-label">Unique Authors</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{(stats.feed_stats.avg_bridging_score * 100).toFixed(1)}%</span>
                  <span className="stat-label">Avg Bridging</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.governance.votes_this_epoch}</span>
                  <span className="stat-label">Votes This Epoch</span>
                </div>
                {stats.metrics?.author_gini !== null && stats.metrics?.author_gini !== undefined && (
                  <div className="stat-card">
                    <span className="stat-value">{(stats.metrics.author_gini * 100).toFixed(1)}%</span>
                    <span className="stat-label">Author Concentration (Gini)</span>
                  </div>
                )}
              </div>
            </section>

            <section className="audit-section">
              <div className="section-header">
                <h2>Recent Governance Activity</h2>
                <Link to="/history" className="view-all-link">View All</Link>
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
                          <span className="audit-epoch">Epoch #{entry.epoch_id}</span>
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

      <style>{`
        .dashboard-page {
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

        .error-container button {
          padding: 0.5rem 1rem;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }

        .dashboard-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1rem;
        }

        .header-content {
          max-width: 1000px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .dashboard-header h1 {
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

        .dashboard-main {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        section {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        section h2 {
          margin: 0;
          font-size: 1.125rem;
          color: #1a1a2e;
        }

        .epoch-badge {
          background: #e7f0ff;
          color: #667eea;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .weights-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          align-items: center;
        }

        .radar-container {
          min-height: 280px;
        }

        .weights-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .weight-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .weight-name {
          min-width: 120px;
          font-size: 0.875rem;
          color: #1a1a2e;
        }

        .weight-bar-container {
          flex: 1;
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
        }

        .weight-bar {
          height: 100%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 4px;
        }

        .weight-value {
          min-width: 40px;
          font-family: monospace;
          font-size: 0.875rem;
          color: #667eea;
          text-align: right;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }

        .stat-card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
        }

        .stat-value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          color: #1a1a2e;
        }

        .stat-label {
          display: block;
          font-size: 0.75rem;
          color: #666;
          margin-top: 0.25rem;
        }

        .view-all-link {
          color: #667eea;
          text-decoration: none;
          font-size: 0.875rem;
        }

        .view-all-link:hover {
          text-decoration: underline;
        }

        .audit-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .no-activity {
          color: #666;
          text-align: center;
          padding: 1rem;
        }

        .audit-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem;
          background: #f8f9fa;
          border-radius: 6px;
        }

        .audit-action {
          font-weight: 500;
          color: #1a1a2e;
        }

        .audit-meta {
          display: flex;
          gap: 1rem;
          font-size: 0.75rem;
          color: #666;
        }

        .audit-epoch {
          background: #e7f0ff;
          color: #667eea;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
        }

        @media (max-width: 700px) {
          .header-content {
            flex-direction: column;
            gap: 1rem;
            text-align: center;
          }

          .weights-content {
            grid-template-columns: 1fr;
          }

          .audit-item {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
          }
        }
      `}</style>
    </div>
  );
}

export default Dashboard;
