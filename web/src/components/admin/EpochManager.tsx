import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { Epoch } from '../../api/admin';
import { SchedulingPanel } from './SchedulingPanel';
import { formatDate, formatRelative } from '../../utils/format';

export function EpochManager() {
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function fetchEpochs() {
    try {
      const data = await adminApi.getEpochs();
      setEpochs(data.epochs || []);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load epochs' });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchEpochs();
  }, []);

  const currentEpoch = epochs.find(e => e.status === 'active');

  async function handleToggleVoting() {
    if (!currentEpoch) return;

    try {
      if (currentEpoch.votingOpen) {
        await adminApi.closeVoting();
        setMessage({ type: 'success', text: 'Voting closed' });
      } else {
        await adminApi.openVoting();
        setMessage({ type: 'success', text: 'Voting opened' });
      }
      fetchEpochs();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Action failed' });
    }
  }

  async function handleTransition(force: boolean) {
    setIsTransitioning(true);
    setMessage(null);

    try {
      const result = await adminApi.transitionEpoch({ force, announceResults: true });
      setMessage({
        type: 'success',
        text: `Epoch ${result.newEpoch.id} started! ${result.announcement ? 'Announcement posted.' : ''}`
      });
      fetchEpochs();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Transition failed' });
    } finally {
      setIsTransitioning(false);
    }
  }

  if (isLoading) {
    return <div className="admin-loading"><div className="loading-spinner" /></div>;
  }

  return (
    <div className="epoch-manager">
      {message && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="admin-card">
        <h2>Current Epoch</h2>

        {currentEpoch ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '24px', fontWeight: 600, color: '#f1f3f5' }}>
                Epoch {currentEpoch.id}
              </span>
              <span className={`status-badge ${currentEpoch.votingOpen ? 'open' : 'closed'}`}>
                {currentEpoch.votingOpen ? 'Voting Open' : 'Voting Closed'}
              </span>
            </div>

            <div className="stats-grid" style={{ marginBottom: '24px' }}>
              <div className="stat-item">
                <div className="stat-label">Votes</div>
                <div className="stat-number">{currentEpoch.voteCount}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Started</div>
                <div className="stat-number" style={{ fontSize: '16px' }}>
                  {formatRelative(currentEpoch.createdAt)}
                </div>
              </div>
              {currentEpoch.votingEndsAt && (
                <div className="stat-item">
                  <div className="stat-label">Ends</div>
                  <div className="stat-number" style={{ fontSize: '16px' }}>
                    {formatRelative(currentEpoch.votingEndsAt)}
                  </div>
                </div>
              )}
            </div>

            <h3>Current Weights</h3>
            <div style={{ marginBottom: '20px' }}>
              {Object.entries(currentEpoch.weights).map(([key, value]) => (
                <div key={key} className="stat-row">
                  <span style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                  <strong>{(value * 100).toFixed(0)}%</strong>
                </div>
              ))}
            </div>

            <h3>Content Rules</h3>
            <div className="keyword-section">
              <label>Include:</label>
              <div className="keyword-pills">
                {currentEpoch.contentRules.include_keywords?.length > 0 ? (
                  currentEpoch.contentRules.include_keywords.map(k => (
                    <span key={k} className="pill pill-include">{k}</span>
                  ))
                ) : (
                  <span className="no-rules">None</span>
                )}
              </div>
            </div>
            <div className="keyword-section">
              <label>Exclude:</label>
              <div className="keyword-pills">
                {currentEpoch.contentRules.exclude_keywords?.length > 0 ? (
                  currentEpoch.contentRules.exclude_keywords.map(k => (
                    <span key={k} className="pill pill-exclude">{k}</span>
                  ))
                ) : (
                  <span className="no-rules">None</span>
                )}
              </div>
            </div>

            <div className="section-divider" />

            <div className="button-group">
              <button className="btn-secondary" onClick={handleToggleVoting}>
                {currentEpoch.votingOpen ? 'Close Voting' : 'Reopen Voting'}
              </button>

              <button
                className="btn-primary"
                onClick={() => handleTransition(false)}
                disabled={isTransitioning || currentEpoch.voteCount < 1}
              >
                {isTransitioning ? 'Transitioning...' : 'Transition to New Epoch'}
              </button>
            </div>

            {currentEpoch.voteCount < 5 && (
              <button
                className="btn-warning"
                style={{ marginTop: '12px' }}
                onClick={() => handleTransition(true)}
                disabled={isTransitioning}
              >
                Force Transition (bypass vote minimum)
              </button>
            )}
          </>
        ) : (
          <p className="empty-state">No active epoch found</p>
        )}
      </div>

      <div className="admin-card">
        <h2>Scheduling</h2>
        <SchedulingPanel epoch={currentEpoch} onUpdate={fetchEpochs} />
      </div>

      <div className="admin-card">
        <h2>Epoch History</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Epoch</th>
              <th>Status</th>
              <th>Votes</th>
              <th>Started</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {epochs.map(epoch => (
              <tr key={epoch.id} className={epoch.status === 'active' ? 'active-row' : ''}>
                <td>{epoch.id}</td>
                <td>
                  <span className={`status-badge ${epoch.status}`}>
                    {epoch.status}
                  </span>
                </td>
                <td>{epoch.voteCount}</td>
                <td>{formatDate(epoch.createdAt)}</td>
                <td>{epoch.endedAt ? formatDate(epoch.endedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
