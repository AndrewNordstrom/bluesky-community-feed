/**
 * Admin Dashboard Page
 *
 * Main admin interface with tabbed navigation for:
 * - Overview: System status summary
 * - Epochs: Epoch management and transitions
 * - Announcements: Bot announcements
 * - Feed Health: System health monitoring
 * - Audit Log: Activity logging
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminGuard } from '../components/admin/AdminGuard';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { useAuth } from '../contexts/AuthContext';
import '../styles/admin.css';

type AdminTab = 'overview' | 'epochs' | 'announcements' | 'health' | 'audit';

// Placeholder panels - will be replaced with full implementations in Phase 6
function OverviewPanel({ onNavigate }: { onNavigate: (tab: AdminTab) => void }) {
  const { status, refetch } = useAdminStatus();

  if (!status) {
    return <div className="admin-card"><p>Loading...</p></div>;
  }

  const { currentEpoch, feed, contentRules } = status.system;

  return (
    <div className="overview-grid">
      <div className="stat-card" onClick={() => onNavigate('epochs')} style={{ cursor: 'pointer' }}>
        <div className="stat-card-header">
          <h3>Current Epoch</h3>
          {currentEpoch && (
            <span className={`status-badge ${currentEpoch.status}`}>
              {currentEpoch.status}
            </span>
          )}
        </div>
        {currentEpoch ? (
          <>
            <div className="stat-value">#{currentEpoch.id}</div>
            <div className="stat-row">
              <span>Votes</span>
              <strong>{currentEpoch.voteCount}</strong>
            </div>
            <div className="stat-row">
              <span>Voting</span>
              <strong>{currentEpoch.votingOpen ? 'Open' : 'Closed'}</strong>
            </div>
          </>
        ) : (
          <p className="no-rules">No active epoch</p>
        )}
      </div>

      <div className="stat-card" onClick={() => onNavigate('health')} style={{ cursor: 'pointer' }}>
        <div className="stat-card-header">
          <h3>Feed Status</h3>
        </div>
        <div className="stat-value">{feed.totalPosts.toLocaleString()}</div>
        <div className="stat-row">
          <span>Posts (total)</span>
          <strong>{feed.totalPosts.toLocaleString()}</strong>
        </div>
        <div className="stat-row">
          <span>Last 24h</span>
          <strong>{feed.postsLast24h.toLocaleString()}</strong>
        </div>
        <div className="stat-row">
          <span>Subscribers</span>
          <strong>{feed.subscriberCount.toLocaleString()}</strong>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-card-header">
          <h3>Content Rules</h3>
        </div>
        <div className="keyword-section">
          <label>Include</label>
          <div className="keyword-pills">
            {contentRules.includeKeywords.length > 0 ? (
              contentRules.includeKeywords.map(kw => (
                <span key={kw} className="pill pill-include">{kw}</span>
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>
        </div>
        <div className="keyword-section">
          <label>Exclude</label>
          <div className="keyword-pills">
            {contentRules.excludeKeywords.length > 0 ? (
              contentRules.excludeKeywords.map(kw => (
                <span key={kw} className="pill pill-exclude">{kw}</span>
              ))
            ) : (
              <span className="no-rules">None</span>
            )}
          </div>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-card-header">
          <h3>Scoring Pipeline</h3>
        </div>
        <div className="stat-row">
          <span>Last run</span>
          <strong>
            {feed.lastScoringRun
              ? new Date(feed.lastScoringRun).toLocaleTimeString()
              : 'Never'}
          </strong>
        </div>
        <div className="stat-row">
          <span>Duration</span>
          <strong>
            {feed.lastScoringDuration !== null
              ? `${feed.lastScoringDuration.toFixed(1)}s`
              : '-'}
          </strong>
        </div>
        <div className="stat-row">
          <span>Posts scored</span>
          <strong>{feed.scoredPosts.toLocaleString()}</strong>
        </div>
        <button className="btn-secondary" onClick={() => refetch()} style={{ marginTop: '12px', width: '100%' }}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function EpochManager() {
  return (
    <div className="admin-card">
      <h2>Epoch Management</h2>
      <p className="empty-state">Epoch management panel - coming in Phase 6</p>
    </div>
  );
}

function AnnouncementPanel() {
  return (
    <div className="admin-card">
      <h2>Announcements</h2>
      <p className="empty-state">Announcements panel - coming in Phase 6</p>
    </div>
  );
}

function FeedHealthPanel() {
  return (
    <div className="admin-card">
      <h2>Feed Health</h2>
      <p className="empty-state">Feed health panel - coming in Phase 6</p>
    </div>
  );
}

function AuditLogPanel() {
  return (
    <div className="admin-card">
      <h2>Audit Log</h2>
      <p className="empty-state">Audit log panel - coming in Phase 6</p>
    </div>
  );
}

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const { userHandle, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <AdminGuard>
      <div className="admin-page">
        <header className="admin-page-header">
          <div className="header-content">
            <div className="header-left">
              <h1>Community feed</h1>
              <nav className="header-nav">
                <Link to="/vote" className="nav-link">Vote</Link>
                <Link to="/dashboard" className="nav-link">Dashboard</Link>
                <Link to="/history" className="nav-link">History</Link>
                <Link to="/admin" className="nav-link active">Admin</Link>
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

        <div className="admin-container">
          <header className="admin-header">
            <h1>Admin Dashboard</h1>
            <p className="admin-subtitle">Manage feed governance and monitor system health</p>
          </header>

          <nav className="admin-tabs">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'epochs', label: 'Epochs' },
              { id: 'announcements', label: 'Announcements' },
              { id: 'health', label: 'Feed Health' },
              { id: 'audit', label: 'Audit Log' }
            ].map(tab => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id as AdminTab)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <main className="admin-content">
            {activeTab === 'overview' && <OverviewPanel onNavigate={setActiveTab} />}
            {activeTab === 'epochs' && <EpochManager />}
            {activeTab === 'announcements' && <AnnouncementPanel />}
            {activeTab === 'health' && <FeedHealthPanel />}
            {activeTab === 'audit' && <AuditLogPanel />}
          </main>
        </div>
      </div>
    </AdminGuard>
  );
}

export default AdminPage;
