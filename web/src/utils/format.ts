/**
 * Format Utilities
 */

export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMs < 0) {
    const futureSec = Math.abs(diffSec);
    const futureMin = Math.floor(futureSec / 60);
    const futureHour = Math.floor(futureMin / 60);
    const futureDay = Math.floor(futureHour / 24);

    if (futureDay > 0) return `in ${futureDay}d`;
    if (futureHour > 0) return `in ${futureHour}h`;
    if (futureMin > 0) return `in ${futureMin}m`;
    return 'in a moment';
  }

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return formatDate(dateStr);
}

export function truncateDid(did: string): string {
  if (did === 'system') return 'System';
  if (did.length <= 20) return did;
  return `${did.slice(0, 12)}...${did.slice(-6)}`;
}

export function formatActionName(action: string): string {
  return action
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
