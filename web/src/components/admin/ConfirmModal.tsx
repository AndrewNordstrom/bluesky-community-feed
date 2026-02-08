import { useEffect } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText: string;
  confirmStyle?: 'danger' | 'warning';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmText,
  confirmStyle = 'warning',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="confirm-modal-title" className="modal-title">
          {title}
        </h3>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button
            type="button"
            className={confirmStyle === 'danger' ? 'btn-danger' : 'btn-warning'}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Working...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
