import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface LegalDocResponse {
  content: string;
  document: 'tos' | 'privacy';
  version: string;
  lastUpdated: string;
}

interface LegalDocumentProps {
  document: 'tos' | 'privacy';
}

export function LegalDocument({ document }: LegalDocumentProps) {
  const [content, setContent] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const title = document === 'tos' ? 'Terms of Service' : 'Privacy Policy';

  useEffect(() => {
    const fetchDoc = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.get<LegalDocResponse>(`/api/legal/${document}`);
        setContent(response.data.content);
        setLastUpdated(response.data.lastUpdated);
      } catch {
        setError('Failed to load document.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchDoc();
  }, [document]);

  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <button
            className="legal-back"
            onClick={() => navigate(-1)}
            type="button"
          >
            &larr; Back
          </button>
          <h1>{title}</h1>
          {lastUpdated && (
            <p className="legal-updated">Last updated: {lastUpdated}</p>
          )}
        </div>

        {isLoading && <p className="legal-loading">Loading...</p>}
        {error && <p className="legal-error">{error}</p>}
        {content && (
          <div className="legal-content">{content}</div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .legal-page {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    background: var(--bg-app);
  }

  .legal-container {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    max-width: 720px;
    width: 100%;
    align-self: flex-start;
  }

  .legal-header {
    margin-bottom: var(--space-6);
    padding-bottom: var(--space-6);
    border-bottom: 1px solid var(--border-default);
  }

  .legal-back {
    background: none;
    border: none;
    color: var(--accent-blue);
    cursor: pointer;
    font-size: var(--text-sm);
    padding: 0;
    margin-bottom: var(--space-4);
    display: inline-block;
  }

  .legal-back:hover {
    color: var(--accent-blue-hover);
  }

  .legal-header h1 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
  }

  .legal-updated {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .legal-loading {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .legal-error {
    color: var(--status-error);
    font-size: var(--text-sm);
  }

  .legal-content {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    white-space: pre-wrap;
    word-break: break-word;
  }
`;

export default LegalDocument;
