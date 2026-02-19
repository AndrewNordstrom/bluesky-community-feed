import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { consentApi } from '../api/client';

export function ResearchConsent() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    // Check if already decided
    const checkStatus = async () => {
      try {
        const status = await consentApi.getStatus();
        if (status.consent !== null) {
          navigate('/vote');
          return;
        }
      } catch {
        // If check fails, show the form anyway
      } finally {
        setIsLoading(false);
      }
    };

    checkStatus();
  }, [isAuthenticated, navigate]);

  const handleConsent = async (consent: boolean) => {
    setError(null);
    setIsSubmitting(true);

    try {
      await consentApi.submit(consent);
      navigate('/vote');
    } catch {
      setError('Failed to record your choice. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="consent-page">
        <div className="consent-container">
          <p className="consent-loading">Loading...</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="consent-page">
      <div className="consent-container">
        <h1>Research Participation</h1>
        <p className="consent-description">
          This feed is part of a research project exploring community algorithmic governance.
          Your participation in research is <strong>entirely optional</strong> and does not
          affect your ability to vote or use any features.
        </p>

        <div className="consent-details">
          <h3>What research participation means</h3>
          <ul>
            <li>Your voting data (weights, keywords, timestamps) may be analyzed in aggregate</li>
            <li>Your Bluesky DID will be associated with your votes in the research dataset</li>
            <li>Published findings will use aggregated or de-identified data</li>
            <li>Individual voting behavior will not be attributed to you without additional consent</li>
          </ul>

          <h3>What happens if you decline</h3>
          <ul>
            <li>You retain full access to voting and all governance features</li>
            <li>Your data is used only for service operation (feed ranking, governance aggregation)</li>
            <li>Your data is excluded from any research analysis or publication</li>
          </ul>

          <p className="consent-withdraw">
            You can change your mind at any time by contacting hello@corgi.network.
            See our{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>{' '}
            for full details.
          </p>
        </div>

        {error && <div className="consent-error">{error}</div>}

        <div className="consent-actions">
          <button
            className="consent-button consent-agree"
            onClick={() => handleConsent(true)}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? 'Saving...' : 'I agree to participate'}
          </button>
          <button
            className="consent-button consent-decline"
            onClick={() => handleConsent(false)}
            disabled={isSubmitting}
            type="button"
          >
            No thanks
          </button>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .consent-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-app);
  }

  .consent-container {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    max-width: 520px;
    width: 100%;
  }

  .consent-container h1 {
    margin: 0 0 var(--space-3) 0;
    color: var(--text-primary);
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    text-align: center;
  }

  .consent-description {
    color: var(--text-secondary);
    margin-bottom: var(--space-6);
    line-height: var(--leading-relaxed);
    text-align: center;
    font-size: var(--text-sm);
  }

  .consent-description strong {
    color: var(--text-primary);
  }

  .consent-details {
    margin-bottom: var(--space-6);
    padding: var(--space-5);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-default);
  }

  .consent-details h3 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
  }

  .consent-details h3:not(:first-child) {
    margin-top: var(--space-4);
  }

  .consent-details ul {
    margin: 0 0 var(--space-2) 0;
    padding-left: var(--space-5);
  }

  .consent-details li {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed);
    margin-bottom: var(--space-1);
  }

  .consent-withdraw {
    margin: var(--space-4) 0 0 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed);
  }

  .consent-withdraw a {
    color: var(--text-secondary);
    text-decoration: underline;
  }

  .consent-withdraw a:hover {
    color: var(--accent-blue);
  }

  .consent-error {
    background: rgba(255, 69, 58, 0.1);
    border: 1px solid rgba(255, 69, 58, 0.2);
    color: var(--status-error);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .consent-loading {
    color: var(--text-secondary);
    text-align: center;
    font-size: var(--text-sm);
  }

  .consent-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .consent-button {
    padding: var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .consent-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .consent-agree {
    background: var(--accent-blue);
    color: white;
    border: none;
  }

  .consent-agree:hover:not(:disabled) {
    background: var(--accent-blue-hover);
  }

  .consent-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
  }

  .consent-decline:hover:not(:disabled) {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }
`;

export default ResearchConsent;
