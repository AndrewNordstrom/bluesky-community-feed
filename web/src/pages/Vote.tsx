import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { WeightSliders } from '../components/WeightSliders';
import type { GovernanceWeights } from '../components/WeightSliders';
import { voteApi, weightsApi } from '../api/client';
import type { EpochResponse } from '../api/client';

export function Vote() {
  const { isAuthenticated, isLoading: authLoading, userHandle, logout } = useAuth();
  const navigate = useNavigate();

  const [currentEpoch, setCurrentEpoch] = useState<EpochResponse | null>(null);
  const [weights, setWeights] = useState<GovernanceWeights | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load current epoch and user's vote
  const loadData = useCallback(async () => {
    try {
      setIsLoadingData(true);
      setError(null);

      // Get current epoch
      const epoch = await weightsApi.getCurrentEpoch();
      setCurrentEpoch(epoch);

      // Set initial weights to current epoch weights (convert from snake_case)
      setWeights({
        recency: epoch.weights.recency,
        engagement: epoch.weights.engagement,
        bridging: epoch.weights.bridging,
        sourceDiversity: epoch.weights.source_diversity,
        relevance: epoch.weights.relevance,
      });

      // Check if user has voted (if authenticated)
      if (isAuthenticated) {
        try {
          const voteData = await voteApi.getVote();
          if (voteData.hasVoted && voteData.vote) {
            setHasVoted(true);
            // Use their existing vote as initial weights
            setWeights({
              recency: voteData.vote.recency_weight,
              engagement: voteData.vote.engagement_weight,
              bridging: voteData.vote.bridging_weight,
              sourceDiversity: voteData.vote.source_diversity_weight,
              relevance: voteData.vote.relevance_weight,
            });
          }
        } catch {
          // User hasn't voted yet
          setHasVoted(false);
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load data');
    } finally {
      setIsLoadingData(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const handleWeightChange = useCallback((newWeights: GovernanceWeights) => {
    setWeights(newWeights);
    setSuccessMessage(null);
  }, []);

  const handleSubmit = async () => {
    if (!weights) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await voteApi.submitVote(weights);
      setHasVoted(true);
      setSuccessMessage(
        hasVoted
          ? 'Your vote has been updated!'
          : 'Your vote has been recorded! Thank you for participating in governance.'
      );
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit vote');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (authLoading || isLoadingData) {
    return (
      <div className="vote-page">
        <div className="loading">
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="vote-page">
      <header className="vote-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Community feed</h1>
            <nav className="header-nav">
              <Link to="/vote" className="nav-link active">Vote</Link>
              <Link to="/dashboard" className="nav-link">Dashboard</Link>
              <Link to="/history" className="nav-link">History</Link>
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

      <main className="vote-main">
        {currentEpoch && (
          <div className="epoch-info">
            <div className="epoch-status">
              <span className={`status-badge ${currentEpoch.status}`}>
                {currentEpoch.status === 'voting' ? 'Voting open' : 'Active'}
              </span>
              <span className="epoch-id">Epoch {currentEpoch.id}</span>
            </div>
            <div className="vote-count">
              <strong>{currentEpoch.vote_count}</strong> votes
              {currentEpoch.subscriber_count !== undefined && (
                <span className="subscriber-count">
                  {' '}/ {currentEpoch.subscriber_count} subscribers
                </span>
              )}
            </div>
          </div>
        )}

        <section className="voting-section">
          <h2>Your vote</h2>
          <p className="vote-description">
            Adjust the sliders to set your preferred algorithm weights. The sliders
            are linked and will always sum to 100%. Your vote will influence how
            the feed ranks posts in future epochs.
          </p>

          {error && <div className="error-message">{error}</div>}
          {successMessage && <div className="success-message">{successMessage}</div>}

          {weights && (
            <WeightSliders
              initialWeights={weights}
              onChange={handleWeightChange}
              disabled={isSubmitting}
            />
          )}

          <div className="vote-actions">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !weights}
              className="submit-button"
            >
              {isSubmitting
                ? 'Submitting...'
                : hasVoted
                ? 'Update vote'
                : 'Submit vote'}
            </button>
            {hasVoted && (
              <span className="voted-indicator">You have already voted this epoch</span>
            )}
          </div>
        </section>

        <section className="current-weights-section">
          <h2>Current algorithm weights</h2>
          <p className="section-description">
            These are the weights currently being used by the feed algorithm,
            determined by community votes from the previous epoch.
          </p>
          {currentEpoch && (
            <div className="current-weights-grid">
              {Object.entries(currentEpoch.weights).map(([key, value]) => (
                <div key={key} className="weight-card">
                  <span className="weight-name">
                    {key === 'source_diversity' ? 'Source diversity' : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}
                  </span>
                  <span className="weight-value">{(value * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .vote-page {
    min-height: 100vh;
    background: var(--bg-app);
  }

  .loading {
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

  .vote-header {
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

  .vote-header h1 {
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

  .vote-main {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  .epoch-info {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-6);
    margin-bottom: var(--space-6);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .epoch-status {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .status-badge {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-semibold);
  }

  .status-badge.active {
    background: var(--accent-blue-subtle);
    color: var(--accent-blue);
  }

  .status-badge.voting {
    background: rgba(52, 199, 89, 0.15);
    color: var(--status-success);
  }

  .epoch-id {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .vote-count {
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .subscriber-count {
    color: var(--text-secondary);
  }

  .voting-section, .current-weights-section {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .voting-section h2, .current-weights-section h2 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
  }

  .vote-description, .section-description {
    color: var(--text-secondary);
    margin-bottom: var(--space-6);
    line-height: var(--leading-relaxed);
    font-size: var(--text-base);
  }

  .error-message {
    background: rgba(255, 69, 58, 0.1);
    border: 1px solid rgba(255, 69, 58, 0.2);
    color: var(--status-error);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .success-message {
    background: rgba(52, 199, 89, 0.1);
    border: 1px solid rgba(52, 199, 89, 0.2);
    color: var(--status-success);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .vote-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-6);
  }

  .submit-button {
    background: var(--accent-blue);
    color: white;
    border: none;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .submit-button:hover:not(:disabled) {
    background: var(--accent-blue-hover);
  }

  .submit-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voted-indicator {
    color: var(--status-success);
    font-size: var(--text-sm);
  }

  .current-weights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-4);
  }

  .weight-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    text-align: center;
  }

  .weight-name {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
  }

  .weight-value {
    display: block;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
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

    .vote-main {
      padding: var(--space-4);
    }

    .epoch-info {
      flex-direction: column;
      gap: var(--space-3);
      text-align: center;
    }

    .vote-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .voted-indicator {
      text-align: center;
    }
  }
`;

export default Vote;
