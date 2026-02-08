import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { AuditEntry } from '../../api/admin';
import { formatRelative, truncateDid, formatActionName } from '../../utils/format';

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'vote_cast', label: 'Votes Cast' },
  { value: 'vote_updated', label: 'Votes Updated' },
  { value: 'epoch_transition', label: 'Epoch Transitions' },
  { value: 'auto_epoch_transition', label: 'Auto Transitions' },
  { value: 'voting_opened', label: 'Voting Opened' },
  { value: 'voting_closed', label: 'Voting Closed' },
  { value: 'epoch_updated', label: 'Epoch Updated' },
  { value: 'announcement_posted', label: 'Announcements' },
  { value: 'manual_rescore', label: 'Manual Rescores' },
];

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ action: '', limit: 50 });
  const [isLoading, setIsLoading] = useState(true);

  async function fetchLog() {
    setIsLoading(true);
    try {
      const data = await adminApi.getAuditLog(filter);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch audit log', err);
      setEntries([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchLog();
  }, [filter.action, filter.limit]);

  function handleLoadMore() {
    setFilter(f => ({ ...f, limit: f.limit + 50 }));
  }

  return (
    <div className="admin-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Audit Log</h2>
        <select
          value={filter.action}
          onChange={(e) => setFilter({ ...filter, action: e.target.value, limit: 50 })}
          style={{
            background: '#161718',
            border: '1px solid #2a2b2d',
            borderRadius: '8px',
            padding: '8px 12px',
            color: '#f1f3f5',
            fontSize: '14px'
          }}
        >
          {ACTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : entries.length === 0 ? (
        <p className="empty-state">No audit entries found</p>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatRelative(entry.timestamp)}
                  </td>
                  <td>
                    <span className={`status-badge ${getActionBadgeClass(entry.action)}`}>
                      {formatActionName(entry.action)}
                    </span>
                  </td>
                  <td>
                    {entry.actor === 'system' ? (
                      <span style={{ color: '#787c7e', fontStyle: 'italic' }}>System</span>
                    ) : (
                      <span title={entry.actor} style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        {truncateDid(entry.actor)}
                      </span>
                    )}
                  </td>
                  <td>
                    <code style={{
                      background: '#161718',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: '#787c7e',
                      display: 'inline-block',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {JSON.stringify(entry.details)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > filter.limit && (
            <button
              className="btn-secondary"
              style={{ marginTop: '16px', width: '100%' }}
              onClick={handleLoadMore}
            >
              Load More ({total - filter.limit} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function getActionBadgeClass(action: string): string {
  if (action.includes('transition')) return 'active';
  if (action.includes('vote')) return 'open';
  if (action.includes('failed') || action.includes('error')) return 'error';
  return 'closed';
}
