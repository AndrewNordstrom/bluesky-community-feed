import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
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

  const renderedHtml = useMemo(() => {
    if (!content) return '';
    const rawHtml = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  }, [content]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <button
            className="legal-back"
            onClick={handleBack}
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
        {renderedHtml && (
          <div
            className="legal-content"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
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
  }

  .legal-content h1 {
    color: var(--text-primary);
    font-size: var(--text-xl);
    font-weight: var(--font-weight-semibold);
    margin: var(--space-8) 0 var(--space-3) 0;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-default);
  }

  .legal-content h1:first-child {
    display: none;
  }

  .legal-content h2 {
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    margin: var(--space-8) 0 var(--space-3) 0;
  }

  .legal-content h3 {
    color: var(--text-primary);
    font-size: var(--text-base);
    font-weight: var(--font-weight-medium);
    margin: var(--space-6) 0 var(--space-2) 0;
  }

  .legal-content p {
    margin: 0 0 var(--space-4) 0;
  }

  .legal-content ul,
  .legal-content ol {
    margin: 0 0 var(--space-4) 0;
    padding-left: var(--space-6);
  }

  .legal-content li {
    margin-bottom: var(--space-2);
  }

  .legal-content strong {
    color: var(--text-primary);
    font-weight: var(--font-weight-semibold);
  }

  .legal-content a {
    color: var(--accent-blue);
    text-decoration: underline;
  }

  .legal-content a:hover {
    color: var(--accent-blue-hover);
  }

  .legal-content hr {
    border: none;
    border-top: 1px solid var(--border-default);
    margin: var(--space-6) 0;
  }

  .legal-content code {
    background: var(--bg-elevated);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }
`;

export default LegalDocument;
