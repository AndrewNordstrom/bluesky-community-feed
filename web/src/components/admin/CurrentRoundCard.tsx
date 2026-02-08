import { useMemo, useState } from 'react';
import { adminApi, type RoundSummary } from '../../api/admin';
import { formatRelative } from '../../utils/format';
import { ConfirmModal } from './ConfirmModal';

interface CurrentRoundCardProps {
  round: RoundSummary | null;
  onAction: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type PendingAction = 'end-round' | 'force-new-round' | null;

export function CurrentRoundCard({ round, onAction, onNotify }: CurrentRoundCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const status = useMemo(() => {
    if (!round) {
      return { label: 'No Round', className: 'closed' };
    }

    if (round.status === 'closed') {
      return { label: 'Voting Closed', className: 'closed' };
    }

    if (round.votingEndsAt && round.autoTransition) {
      return { label: 'Scheduled', className: 'scheduled' };
    }

    return { label: 'Voting Open', className: 'open' };
  }, [round]);

  async function handleApplyResults() {
    setIsSubmitting(true);
    try {
      const result = await adminApi.applyResults();
      onNotify(
        'success',
        result.appliedWeights
          ? 'Applied community vote results to current round'
          : 'No votes were present, current weights were kept'
      );
      await onAction();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to apply results');
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
      const force = pendingAction === 'force-new-round';
      await adminApi.endRound(force);
      onNotify('success', force ? 'Forced round transition complete' : 'Round ended and new round started');
      setPendingAction(null);
      await onAction();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to transition round');
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

  return (
    <>
      <div className="admin-card current-round-card">
        <h2>Current Round</h2>

        <div className="round-header">
          <div className="round-number">Round {round.id}</div>
          <span className={`status-badge ${status.className}`}>{status.label}</span>
        </div>

        <div className="round-meta">
          <span>{round.voteCount} votes</span>
          <span>Started {formatRelative(round.createdAt)}</span>
          {round.votingEndsAt ? <span>Ends {formatRelative(round.votingEndsAt)}</span> : null}
        </div>

        <div className="action-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleApplyResults}
            disabled={isSubmitting}
          >
            Apply Results
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleExtendVoting(24)}
            disabled={isSubmitting}
          >
            Extend 24h
          </button>
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

        <p className="help-text">
          <span className="help-text-icon">i</span>
          <span>Voters can adjust weights and suggest keywords while voting is open.</span>
        </p>
      </div>

      {pendingAction ? (
        <ConfirmModal
          title={pendingAction === 'force-new-round' ? 'Force New Round?' : 'End Round and Start New?'}
          message={
            pendingAction === 'force-new-round'
              ? 'This will force a transition even without votes. Continue?'
              : 'This will close the current round and start the next one. Continue?'
          }
          confirmText={pendingAction === 'force-new-round' ? 'Force Transition' : 'End Round'}
          confirmStyle={pendingAction === 'force-new-round' ? 'danger' : 'warning'}
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
