import { useAdminStatus } from '../../hooks/useAdminStatus';
import { formatNumber, formatRelative } from '../../utils/format';
import { AdminPanelSkeleton } from '../Skeleton';

interface OverviewPanelProps {
  onNavigate: (tab: string) => void;
}

export function OverviewPanel({ onNavigate }: OverviewPanelProps) {
  const { status, isLoading, refetch } = useAdminStatus();

  if (isLoading || !status) {
    return <AdminPanelSkeleton />;
  }

  const { system } = status;
  const epoch = system.currentEpoch;

  return (
    <div className="overview-grid content-loaded">
      <div className="stat-card">
        <div className="stat-card-header">
          <h3>Current Round</h3>
          {epoch && (
            <span className={`status-badge ${epoch.votingOpen ? 'open' : 'closed'}`}>
              {epoch.votingOpen ? 'Voting Open' : 'Voting Closed'}
            </span>
          )}
        </div>
        {epoch ? (
          <>
            <div className="stat-value">Round {epoch.id}</div>
            <div className="stat-row">
              <span>Votes cast</span>
              <strong>{epoch.voteCount}</strong>
            </div>
            {epoch.votingEndsAt && (
              <div className="stat-row">
                <span>Voting ends</span>
                <strong>{formatRelative(epoch.votingEndsAt)}</strong>
              </div>
            )}
            <div className="stat-row">
              <span>Auto-transition</span>
              <strong>{epoch.autoTransition ? 'Enabled' : 'Disabled'}</strong>
            </div>
            <div className="button-group" style={{ marginTop: '16px' }}>
              <button className="btn-secondary" onClick={() => onNavigate('governance')}>
                Manage
              </button>
            </div>
          </>
        ) : (
          <p className="empty-state">No active round</p>
        )}
      </div>

      <div className="stat-card">
        <h3>Feed Status</h3>
        <div className="stat-row">
          <span>Posts in feed</span>
          <strong>{system.feed.scoredPosts}</strong>
        </div>
        <div className="stat-row">
          <span>Total indexed</span>
          <strong>{formatNumber(system.feed.totalPosts)}</strong>
        </div>
        <div className="stat-row">
          <span>Subscribers</span>
          <strong>{system.feed.subscriberCount}</strong>
        </div>
        <div className="stat-row">
          <span>Last scoring</span>
          <strong>{system.feed.lastScoringRun ? formatRelative(system.feed.lastScoringRun) : 'Never'}</strong>
        </div>
        <div className="button-group" style={{ marginTop: '16px' }}>
          <button className="btn-secondary" onClick={() => onNavigate('health')}>
            View Details
          </button>
        </div>
      </div>

      <div className="stat-card">
        <h3>Active Content Rules</h3>
        <div className="keyword-section">
          <label>Include keywords:</label>
          <div className="keyword-pills">
            {system.contentRules?.includeKeywords?.length > 0 ? (
              system.contentRules.includeKeywords.map(k => (
                <span key={k} className="pill pill-include">{k}</span>
              ))
            ) : (
              <span className="no-rules">None set</span>
            )}
          </div>
        </div>
        <div className="keyword-section">
          <label>Exclude keywords:</label>
          <div className="keyword-pills">
            {system.contentRules?.excludeKeywords?.length > 0 ? (
              system.contentRules.excludeKeywords.map(k => (
                <span key={k} className="pill pill-exclude">{k}</span>
              ))
            ) : (
              <span className="no-rules">None set</span>
            )}
          </div>
        </div>
      </div>

      <div className="stat-card">
        <h3>Quick Actions</h3>
        <div className="button-group-vertical">
          <button className="btn-primary" onClick={() => onNavigate('governance')}>
            Manage Governance
          </button>
          <button className="btn-secondary" onClick={() => onNavigate('announcements')}>
            Post Announcement
          </button>
          <button className="btn-secondary" onClick={() => onNavigate('health')}>
            View Feed Health
          </button>
          <button className="btn-secondary" onClick={() => refetch()}>
            Refresh Data
          </button>
        </div>
      </div>
    </div>
  );
}
