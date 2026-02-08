import { useEffect, useMemo, useState } from 'react';
import { adminApi, type RoundSummary } from '../../api/admin';

interface SchedulingCardProps {
  round: RoundSummary | null;
  onUpdate: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type ScheduleMode = 'manual' | 'scheduled';

function toInputDateTime(value: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function formatCountdown(votingEndsAt: string): string {
  const diff = new Date(votingEndsAt).getTime() - Date.now();
  if (diff <= 0) {
    return 'Voting end time has passed';
  }

  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `Voting ends in ${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `Voting ends in ${hours}h ${minutes}m`;
  }

  return `Voting ends in ${minutes}m`;
}

export function SchedulingCard({ round, onUpdate, onNotify }: SchedulingCardProps) {
  const [mode, setMode] = useState<ScheduleMode>('manual');
  const [votingEndsAtInput, setVotingEndsAtInput] = useState('');
  const [autoTransition, setAutoTransition] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!round) {
      setMode('manual');
      setVotingEndsAtInput('');
      setAutoTransition(false);
      return;
    }

    const scheduled = Boolean(round.votingEndsAt || round.autoTransition);
    setMode(scheduled ? 'scheduled' : 'manual');
    setVotingEndsAtInput(toInputDateTime(round.votingEndsAt));
    setAutoTransition(round.autoTransition);
  }, [round]);

  const hasChanges = useMemo(() => {
    if (!round) {
      return false;
    }

    const initialMode: ScheduleMode = round.votingEndsAt || round.autoTransition ? 'scheduled' : 'manual';
    const initialEndsAt = toInputDateTime(round.votingEndsAt);

    return (
      initialMode !== mode ||
      initialEndsAt !== votingEndsAtInput ||
      round.autoTransition !== autoTransition
    );
  }, [round, mode, votingEndsAtInput, autoTransition]);

  async function handleSave() {
    if (!round) {
      return;
    }

    if (mode === 'scheduled' && !votingEndsAtInput) {
      onNotify('error', 'Please select a voting end time for scheduled mode');
      return;
    }

    setIsSaving(true);

    try {
      if (mode === 'manual') {
        await adminApi.updateEpoch({
          votingEndsAt: null,
          autoTransition: false,
        });
      } else {
        await adminApi.updateEpoch({
          votingEndsAt: new Date(votingEndsAtInput).toISOString(),
          autoTransition,
        });
      }

      onNotify('success', 'Scheduling updated');
      await onUpdate();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to update schedule');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExtend24h() {
    setIsSaving(true);

    try {
      await adminApi.extendVoting(24);
      onNotify('success', 'Voting window extended by 24 hours');
      await onUpdate();
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to extend voting');
    } finally {
      setIsSaving(false);
    }
  }

  if (!round) {
    return (
      <div className="admin-card">
        <h2>Scheduling</h2>
        <p className="empty-state">No active round found.</p>
      </div>
    );
  }

  return (
    <div className="admin-card">
      <h2>Scheduling</h2>

      <div className="radio-group">
        <label className="radio-option">
          <input
            type="radio"
            name="schedule-mode"
            checked={mode === 'manual'}
            onChange={() => setMode('manual')}
          />
          <span>Manual (I&apos;ll manage rounds myself)</span>
        </label>

        <label className="radio-option">
          <input
            type="radio"
            name="schedule-mode"
            checked={mode === 'scheduled'}
            onChange={() => setMode('scheduled')}
          />
          <span>Scheduled</span>
        </label>
      </div>

      {mode === 'scheduled' ? (
        <>
          <div className="form-group">
            <label htmlFor="voting-end">Voting end time</label>
            <input
              id="voting-end"
              type="datetime-local"
              value={votingEndsAtInput}
              onChange={(event) => setVotingEndsAtInput(event.target.value)}
            />
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoTransition}
              onChange={(event) => setAutoTransition(event.target.checked)}
            />
            Automatically start a new round when voting ends
          </label>

          {round.votingEndsAt ? <p className="countdown">{formatCountdown(round.votingEndsAt)}</p> : null}

          <div className="action-buttons">
            <button type="button" className="btn-secondary" onClick={handleExtend24h} disabled={isSaving}>
              Extend 24h
            </button>
          </div>
        </>
      ) : null}

      <div className="action-buttons">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>
    </div>
  );
}
