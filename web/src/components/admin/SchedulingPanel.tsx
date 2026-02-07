import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin';
import type { Epoch } from '../../api/admin';

interface SchedulingPanelProps {
  epoch: Epoch | undefined;
  onUpdate: () => void;
}

export function SchedulingPanel({ epoch, onUpdate }: SchedulingPanelProps) {
  const [votingEndsAt, setVotingEndsAt] = useState('');
  const [autoTransition, setAutoTransition] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (epoch) {
      setVotingEndsAt(epoch.votingEndsAt ? epoch.votingEndsAt.slice(0, 16) : '');
      setAutoTransition(epoch.autoTransition);
    }
  }, [epoch]);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);

    try {
      await adminApi.updateEpoch({
        votingEndsAt: votingEndsAt ? new Date(votingEndsAt).toISOString() : null,
        autoTransition
      });
      setMessage({ type: 'success', text: 'Schedule updated' });
      onUpdate();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClearSchedule() {
    setIsSaving(true);
    setMessage(null);

    try {
      await adminApi.updateEpoch({
        votingEndsAt: null,
        autoTransition: false
      });
      setVotingEndsAt('');
      setAutoTransition(false);
      setMessage({ type: 'success', text: 'Schedule cleared' });
      onUpdate();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to clear' });
    } finally {
      setIsSaving(false);
    }
  }

  if (!epoch) {
    return <p className="empty-state">No active epoch to schedule</p>;
  }

  const minDate = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type}`} style={{ marginBottom: '16px' }}>
          {message.text}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="voting-ends">Voting Ends At</label>
        <input
          type="datetime-local"
          id="voting-ends"
          value={votingEndsAt}
          onChange={(e) => setVotingEndsAt(e.target.value)}
          min={minDate}
        />
        <p className="help-text">Leave empty for no scheduled end time</p>
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={autoTransition}
            onChange={(e) => setAutoTransition(e.target.checked)}
          />
          Auto-transition when voting ends
        </label>
        <p className="help-text">
          Automatically close voting and start a new epoch when the end time is reached.
        </p>
      </div>

      <div className="button-group">
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Schedule'}
        </button>

        {(votingEndsAt || autoTransition) && (
          <button
            className="btn-secondary"
            onClick={handleClearSchedule}
            disabled={isSaving}
          >
            Clear Schedule
          </button>
        )}
      </div>
    </div>
  );
}
