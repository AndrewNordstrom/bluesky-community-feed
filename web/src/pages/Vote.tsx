import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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

      // Set initial weights to current epoch weights
      setWeights(epoch.weights);

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
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="vote-page">
      <header className="vote-header">
        <div className="header-content">
          <h1>Community Feed Governance</h1>
          <div className="user-info">
            <span className="user-handle">@{userHandle}</span>
            <button onClick={handleLogout} className="logout-button">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="vote-main">
        {currentEpoch && (
          <div className="epoch-info">
            <div className="epoch-status">
              <span className={`status-badge ${currentEpoch.status}`}>
                {currentEpoch.status === 'voting' ? 'Voting Open' : 'Active'}
              </span>
              <span className="epoch-id">Epoch #{currentEpoch.id}</span>
            </div>
            <div className="vote-count">
              <strong>{currentEpoch.vote_count}</strong> votes
              {currentEpoch.subscriber_count && (
                <span className="subscriber-count">
                  {' '}
                  / {currentEpoch.subscriber_count} subscribers
                </span>
              )}
            </div>
          </div>
        )}

        <section className="voting-section">
          <h2>Your Vote</h2>
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
                ? 'Update Vote'
                : 'Submit Vote'}
            </button>
            {hasVoted && (
              <span className="voted-indicator">You have already voted this epoch</span>
            )}
          </div>
        </section>

        <section className="current-weights-section">
          <h2>Current Algorithm Weights</h2>
          <p className="section-description">
            These are the weights currently being used by the feed algorithm,
            determined by community votes from the previous epoch.
          </p>
          {currentEpoch && (
            <div className="current-weights-grid">
              {Object.entries(currentEpoch.weights).map(([key, value]) => (
                <div key={key} className="weight-card">
                  <span className="weight-name">
                    {key === 'sourceDiversity' ? 'Source Diversity' : key.charAt(0).toUpperCase() + key.slice(1)}
                  </span>
                  <span className="weight-value">{(value * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <style>{`
        .vote-page {
          min-height: 100vh;
          background: #f5f5f5;
        }

        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          font-size: 1.25rem;
          color: #666;
        }

        .vote-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1rem;
        }

        .header-content {
          max-width: 800px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .vote-header h1 {
          margin: 0;
          font-size: 1.5rem;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .user-handle {
          font-weight: 500;
        }

        .logout-button {
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.875rem;
          transition: background 0.2s;
        }

        .logout-button:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .vote-main {
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }

        .epoch-info {
          background: white;
          border-radius: 8px;
          padding: 1rem 1.5rem;
          margin-bottom: 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .epoch-status {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .status-badge.active {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .status-badge.voting {
          background: #d1fae5;
          color: #047857;
        }

        .epoch-id {
          color: #666;
          font-size: 0.875rem;
        }

        .vote-count {
          color: #1a1a2e;
        }

        .subscriber-count {
          color: #666;
        }

        .voting-section, .current-weights-section {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .voting-section h2, .current-weights-section h2 {
          margin: 0 0 0.5rem 0;
          color: #1a1a2e;
          font-size: 1.25rem;
        }

        .vote-description, .section-description {
          color: #666;
          margin-bottom: 1.5rem;
          line-height: 1.5;
        }

        .error-message {
          background: #fee2e2;
          border: 1px solid #fecaca;
          color: #dc2626;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .success-message {
          background: #d1fae5;
          border: 1px solid #a7f3d0;
          color: #047857;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .vote-actions {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-top: 1.5rem;
        }

        .submit-button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 0.875rem 2rem;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .submit-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .submit-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .voted-indicator {
          color: #047857;
          font-size: 0.875rem;
        }

        .current-weights-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 1rem;
        }

        .weight-card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
        }

        .weight-name {
          display: block;
          font-size: 0.75rem;
          color: #666;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
        }

        .weight-value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          color: #1a1a2e;
        }

        @media (max-width: 600px) {
          .header-content {
            flex-direction: column;
            gap: 1rem;
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
      `}</style>
    </div>
  );
}

export default Vote;
