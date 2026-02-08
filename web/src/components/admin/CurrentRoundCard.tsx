import { useMemo, useState } from 'react';
import { adminApi, type GovernanceWeights, type RoundSummary } from '../../api/admin';
import { formatRelative } from '../../utils/format';
import { ConfirmModal } from './ConfirmModal';

interface CurrentRoundCardProps {
  round: RoundSummary | null;
  onAction: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type PendingAction = 'end-round' | 'force-new-round' | 'end-voting' | 'reject-results' | null;

const WEIGHT_FIELDS: Array<{ key: keyof GovernanceWeights; label: string }> = [
  { key: 'recency', label: 'Recency' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'bridging', label: 'Bridging' },
  { key: 'sourceDiversity', label: 'Source Diversity' },
  { key: 'relevance', label: 'Relevance' },
];

function toPhase(round: RoundSummary): 'running' | 'voting' | 'results' {
  if (round.phase === 'voting' || round.phase === 'results' || round.phase === 'running') {
    return round.phase;
  }

  if (round.status === 'voting') {
    return 'voting';
  }

  return 'running';
}

function formatWeightDiffs(current: GovernanceWeights, proposed: GovernanceWeights) {
  return WEIGHT_FIELDS.map((field) => {
    const currentPct = Math.round(current[field.key] * 100);
    const proposedPct = Math.round(proposed[field.key] * 100);
    const delta = proposedPct - currentPct;
    const deltaLabel = delta > 0 ? `+${delta}%` : `${delta}%`;
    return `${field.label}: ${currentPct}% -> ${proposedPct}% (${deltaLabel})`;
  });
}

export function CurrentRoundCard({ round, onAction, onNotify }: CurrentRoundCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [startDurationHours, setStartDurationHours] = useState(72);

  const phase = useMemo(() => (round ? toPhase(round) : 'running'), [round]);

  const status = useMemo(() => {
    if (!round) {
      return { label: 'No Round', className: 'closed' };
    }

    if (phase === 'voting') {
      return { label: 'Voting Open', className: 'open' };
    }
    if (phase === 'results') {
      return { label: 'Results Pending', className: 'scheduled' };
    }
    return { label: 'Running', className: 'closed' };
  }, [round, phase]);

  async function handleStartVoting() {
    setIsSubmitting(true);
    try {
      await adminApi.startVoting(startDurationHours, true);
      onNotify('success', `Voting started for ${startDurationHours} hours`);
      await onAction();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to start voting');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApproveResults() {
    setIsSubmitting(true);
    try {
      const result = await adminApi.approveResults(true);
      onNotify(
        'success',
        result.rescoreTriggered
          ? 'Results approved and rescore triggered'
          : 'Results approved (rescore already in progress)'
      );
      await onAction();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to approve results');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleExtendVoting(hours: number) {
    setIsSubmitting(true);
    try {
      await adminApi.extendVoting(hours);
      onNotify('success', `Extended voting by ${hours} hours`);
      await onAction();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to extend voting');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (pendingAction === 'end-round' || pendingAction === 'force-new-round') {
        const force = pendingAction === 'force-new-round';
        await adminApi.endRound(force);
        onNotify('success', force ? 'Forced round transition complete' : 'Round ended and new round started');
      } else if (pendingAction === 'end-voting') {
        await adminApi.endVoting(true);
        onNotify('success', 'Voting closed. Results are ready for review.');
      } else if (pendingAction === 'reject-results') {
        await adminApi.rejectResults();
        onNotify('success', 'Proposed results rejected. Round returned to running phase.');
      }

      setPendingAction(null);
      await onAction();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!round) {
    return (
      <div className="admin-card current-round-card">
        <h2>Current Round</h2>
        <p className="empty-state">No active round found.</p>
      </div>
    );
  }

  const proposedWeightDiffs =
    phase === 'results' && round.proposedWeights
      ? formatWeightDiffs(round.weights, round.proposedWeights)
      : [];

  const includeAdds =
    phase === 'results' && round.proposedContentRules
      ? round.proposedContentRules.includeKeywords.filter(
          (keyword) => !round.contentRules.includeKeywords.includes(keyword)
        )
      : [];

  const excludeAdds =
    phase === 'results' && round.proposedContentRules
      ? round.proposedContentRules.excludeKeywords.filter(
          (keyword) => !round.contentRules.excludeKeywords.includes(keyword)
        )
      : [];

  return (
    <>
      <div className="admin-card current-round-card">
        <h2>Current Phase</h2>

        <div className="round-header">
          <div className="round-number">Round {round.id}</div>
          <span className={`status-badge ${status.className}`}>{status.label}</span>
        </div>

        <div className="round-meta">
          <span>{round.voteCount} votes</span>
          <span>Started {formatRelative(round.createdAt)}</span>
          {round.votingEndsAt ? <span>Voting ends {formatRelative(round.votingEndsAt)}</span> : null}
        </div>

        {phase === 'running' ? (
          <>
            <p className="help-text">
              <span className="help-text-icon">i</span>
              <span>Algorithm is running with settled settings. Start a voting period when you want new input.</span>
            </p>
            <div className="action-buttons" style={{ alignItems: 'center' }}>
              <label htmlFor="vote-duration-hours">Voting duration</label>
              <select
                id="vote-duration-hours"
                value={startDurationHours}
                onChange={(event) => setStartDurationHours(Number(event.target.value))}
                disabled={isSubmitting}
              >
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>1 week</option>
              </select>
              <button type="button" className="btn-primary" onClick={handleStartVoting} disabled={isSubmitting}>
                {isSubmitting ? 'Starting...' : 'Start New Voting Period'}
              </button>
            </div>
          </>
        ) : null}

        {phase === 'voting' ? (
          <div className="action-buttons">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPendingAction('end-voting')}
              disabled={isSubmitting}
            >
              End Voting Early
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleExtendVoting(24)}
              disabled={isSubmitting}
            >
              Extend 24h
            </button>
          </div>
        ) : null}

        {phase === 'results' ? (
          <>
            <div className="help-text">
              <span className="help-text-icon">i</span>
              <span>Voting is closed. Review proposed changes, then approve or reject.</span>
            </div>

            {proposedWeightDiffs.length > 0 ? (
              <div className="results-preview">
                <h3>Proposed Weight Changes</h3>
                <ul>
                  {proposedWeightDiffs.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {includeAdds.length > 0 || excludeAdds.length > 0 ? (
              <div className="results-preview">
                <h3>Proposed Keyword Changes</h3>
                {includeAdds.length > 0 ? <p>Include: {includeAdds.join(', ')}</p> : null}
                {excludeAdds.length > 0 ? <p>Exclude: {excludeAdds.join(', ')}</p> : null}
              </div>
            ) : null}

            <div className="action-buttons">
              <button
                type="button"
                className="btn-primary"
                onClick={handleApproveResults}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Applying...' : 'Approve & Apply'}
              </button>
              <button
                type="button"
                className="btn-warning"
                onClick={() => setPendingAction('reject-results')}
                disabled={isSubmitting}
              >
                Reject Results
              </button>
            </div>
          </>
        ) : null}

        <div className="action-buttons" style={{ marginTop: '16px' }}>
          <button
            type="button"
            className="btn-warning"
            onClick={() => setPendingAction('end-round')}
            disabled={isSubmitting}
          >
            End Round &amp; Start New
          </button>
          {round.voteCount === 0 ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => setPendingAction('force-new-round')}
              disabled={isSubmitting}
            >
              Force New Round
            </button>
          ) : null}
        </div>
      </div>

      {pendingAction ? (
        <ConfirmModal
          title={
            pendingAction === 'force-new-round'
              ? 'Force New Round?'
              : pendingAction === 'end-round'
                ? 'End Round and Start New?'
                : pendingAction === 'end-voting'
                  ? 'End Voting Early?'
                  : 'Reject Proposed Results?'
          }
          message={
            pendingAction === 'force-new-round'
              ? 'This will force a transition even without votes.'
              : pendingAction === 'end-round'
                ? 'This will close the current round and create a new round.'
                : pendingAction === 'end-voting'
                  ? 'This will close voting now and move the round to results review.'
                  : 'This will discard proposed changes and return to running phase.'
          }
          confirmText={
            pendingAction === 'force-new-round'
              ? 'Force Transition'
              : pendingAction === 'end-round'
                ? 'End Round'
                : pendingAction === 'end-voting'
                  ? 'End Voting'
                  : 'Reject Results'
          }
          confirmStyle={
            pendingAction === 'force-new-round'
              ? 'danger'
              : pendingAction === 'reject-results'
                ? 'warning'
                : 'warning'
          }
          isLoading={isSubmitting}
          onConfirm={handleConfirmAction}
          onCancel={() => {
            if (!isSubmitting) {
              setPendingAction(null);
            }
          }}
        />
      ) : null}
    </>
  );
}
