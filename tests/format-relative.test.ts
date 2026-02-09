import { describe, expect, it } from 'vitest';
import { formatDate, formatRelative } from '../web/src/utils/format';

describe('formatRelative', () => {
  it('returns N/A for invalid date strings', () => {
    expect(formatRelative('not-a-date')).toBe('N/A');
  });

  it('treats slight future timestamps as just now', () => {
    const nearFuture = new Date(Date.now() + 30_000).toISOString();
    expect(formatRelative(nearFuture)).toBe('just now');
  });

  it('renders absolute date for large future offsets', () => {
    const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(farFuture)).toBe(formatDate(farFuture));
  });
});
