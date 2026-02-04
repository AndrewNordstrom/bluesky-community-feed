import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ScoreRadar } from '../components/ScoreRadar';
import { transparencyApi } from '../api/client';
import type { PostExplanationResponse } from '../api/client';

export function PostExplain() {
  const { uri } = useParams<{ uri: string }>();
  const [explanation, setExplanation] = useState<PostExplanationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExplanation() {
      if (!uri) return;

      try {
        setIsLoading(true);
        setError(null);
        const data = await transparencyApi.getPostExplanation(uri);
        setExplanation(data);
      } catch (err: any) {
        setError(err.response?.data?.message || err.message || 'Failed to load post explanation');
      } finally {
        setIsLoading(false);
      }
    }

    loadExplanation();
  }, [uri]);

  if (isLoading) {
    return (
      <div className="post-explain-page">
        <div className="loading">Loading explanation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="post-explain-page">
        <div className="error-container">
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/dashboard" className="back-link">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  if (!explanation) return null;

  const rankDiff = explanation.counterfactual.difference;
  const rankDirection = rankDiff > 0 ? 'higher' : rankDiff < 0 ? 'lower' : 'same';

  return (
    <div className="post-explain-page">
      <header className="explain-header">
        <div className="header-content">
          <Link to="/dashboard" className="back-link">← Dashboard</Link>
          <h1>Post Score Explanation</h1>
        </div>
      </header>

      <main className="explain-main">
        <section className="overview-section">
          <div className="rank-display">
            <span className="rank-label">Current Rank</span>
            <span className="rank-value">#{explanation.rank}</span>
          </div>
          <div className="score-display">
            <span className="score-label">Total Score</span>
            <span className="score-value">{(explanation.total_score * 100).toFixed(2)}</span>
          </div>
          <div className="epoch-display">
            <span className="epoch-label">Epoch</span>
            <span className="epoch-value">#{explanation.epoch_id}</span>
          </div>
        </section>

        <section className="radar-section">
          <h2>Score Components</h2>
          <div className="radar-container">
            <ScoreRadar
              scores={{
                recency: explanation.components.recency.raw_score,
                engagement: explanation.components.engagement.raw_score,
                bridging: explanation.components.bridging.raw_score,
                sourceDiversity: explanation.components.source_diversity.raw_score,
                relevance: explanation.components.relevance.raw_score,
              }}
              weights={{
                recency: explanation.governance_weights.recency,
                engagement: explanation.governance_weights.engagement,
                bridging: explanation.governance_weights.bridging,
                sourceDiversity: explanation.governance_weights.source_diversity,
                relevance: explanation.governance_weights.relevance,
              }}
              showWeights={true}
              height={350}
            />
          </div>
        </section>

        <section className="breakdown-section">
          <h2>Score Breakdown</h2>
          <table className="score-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Raw Score</th>
                <th>Weight</th>
                <th>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(explanation.components).map(([key, component]) => (
                <tr key={key}>
                  <td className="component-name">
                    {key === 'source_diversity' ? 'Source Diversity' : key.charAt(0).toUpperCase() + key.slice(1)}
                  </td>
                  <td className="score-cell">{(component.raw_score * 100).toFixed(1)}%</td>
                  <td className="weight-cell">{(component.weight * 100).toFixed(0)}%</td>
                  <td className="contribution-cell">
                    <div className="contribution-bar-container">
                      <div
                        className="contribution-bar"
                        style={{ width: `${(component.weighted / explanation.total_score) * 100}%` }}
                      />
                    </div>
                    <span>{(component.weighted * 100).toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Total Score</strong></td>
                <td><strong>{(explanation.total_score * 100).toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="counterfactual-section">
          <h2>Governance Impact</h2>
          <div className="counterfactual-content">
            <p className="counterfactual-description">
              Without community governance (pure engagement ranking), this post would be ranked{' '}
              <strong>#{explanation.counterfactual.pure_engagement_rank}</strong>.
              Community voting has moved it{' '}
              <strong className={`rank-change ${rankDirection}`}>
                {rankDiff === 0
                  ? 'no positions'
                  : `${Math.abs(rankDiff)} position${Math.abs(rankDiff) !== 1 ? 's' : ''} ${
                      rankDiff > 0 ? 'up' : 'down'
                    }`}
              </strong>
              .
            </p>
            <div className="rank-comparison">
              <div className="rank-box">
                <span className="rank-box-label">Pure Engagement</span>
                <span className="rank-box-value">#{explanation.counterfactual.pure_engagement_rank}</span>
              </div>
              <div className="rank-arrow">
                {rankDiff > 0 ? '↑' : rankDiff < 0 ? '↓' : '='}
                <span className="rank-diff">{Math.abs(rankDiff)}</span>
              </div>
              <div className="rank-box current">
                <span className="rank-box-label">Community Governed</span>
                <span className="rank-box-value">#{explanation.rank}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="post-uri-section">
          <h2>Post Details</h2>
          <div className="uri-display">
            <span className="uri-label">AT URI</span>
            <code className="uri-value">{explanation.post_uri}</code>
          </div>
          <div className="scored-at">
            <span className="scored-label">Last Scored</span>
            <span className="scored-value">
              {new Date(explanation.scored_at).toLocaleString()}
            </span>
          </div>
        </section>
      </main>

      <style>{`
        .post-explain-page {
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

        .explain-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1rem;
        }

        .header-content {
          max-width: 900px;
          margin: 0 auto;
        }

        .back-link {
          color: rgba(255, 255, 255, 0.8);
          text-decoration: none;
          font-size: 0.875rem;
        }

        .back-link:hover {
          color: white;
        }

        .explain-header h1 {
          margin: 0.5rem 0 0 0;
          font-size: 1.5rem;
        }

        .explain-main {
          max-width: 900px;
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

        section h2 {
          margin: 0 0 1rem 0;
          font-size: 1.125rem;
          color: #1a1a2e;
        }

        .overview-section {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          text-align: center;
        }

        .rank-display, .score-display, .epoch-display {
          padding: 1rem;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .rank-label, .score-label, .epoch-label {
          display: block;
          font-size: 0.75rem;
          color: #666;
          margin-bottom: 0.25rem;
        }

        .rank-value, .score-value, .epoch-value {
          display: block;
          font-size: 2rem;
          font-weight: 700;
          color: #1a1a2e;
        }

        .radar-container {
          display: flex;
          justify-content: center;
        }

        .score-table {
          width: 100%;
          border-collapse: collapse;
        }

        .score-table th, .score-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }

        .score-table th {
          font-size: 0.75rem;
          color: #666;
          font-weight: 600;
          text-transform: uppercase;
        }

        .component-name {
          font-weight: 500;
        }

        .score-cell, .weight-cell {
          font-family: monospace;
        }

        .contribution-cell {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .contribution-bar-container {
          flex: 1;
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
        }

        .contribution-bar {
          height: 100%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 4px;
        }

        .score-table tfoot td {
          border-bottom: none;
          font-weight: 600;
        }

        .counterfactual-description {
          margin: 0 0 1.5rem 0;
          line-height: 1.6;
          color: #4a5568;
        }

        .rank-change.higher {
          color: #48bb78;
        }

        .rank-change.lower {
          color: #e53e3e;
        }

        .rank-change.same {
          color: #666;
        }

        .rank-comparison {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2rem;
        }

        .rank-box {
          padding: 1rem 1.5rem;
          background: #f8f9fa;
          border-radius: 8px;
          text-align: center;
        }

        .rank-box.current {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .rank-box-label {
          display: block;
          font-size: 0.75rem;
          opacity: 0.8;
        }

        .rank-box-value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          margin-top: 0.25rem;
        }

        .rank-arrow {
          font-size: 1.5rem;
          color: #667eea;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .rank-diff {
          font-size: 0.875rem;
        }

        .uri-display, .scored-at {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.75rem;
        }

        .uri-label, .scored-label {
          min-width: 100px;
          font-size: 0.875rem;
          color: #666;
        }

        .uri-value {
          flex: 1;
          padding: 0.5rem;
          background: #f8f9fa;
          border-radius: 4px;
          font-size: 0.75rem;
          word-break: break-all;
        }

        @media (max-width: 600px) {
          .overview-section {
            grid-template-columns: 1fr;
          }

          .rank-comparison {
            flex-direction: column;
            gap: 1rem;
          }

          .uri-display, .scored-at {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  );
}

export default PostExplain;
