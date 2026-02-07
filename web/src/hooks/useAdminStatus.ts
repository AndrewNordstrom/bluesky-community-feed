/**
 * useAdminStatus Hook
 *
 * Fetches admin status from the API and provides loading/error states.
 * Used by AdminGuard to check if the current user is an admin.
 */

import { useState, useEffect } from 'react';
import { adminApi } from '../api/admin';
import type { AdminStatus } from '../api/admin';

export function useAdminStatus() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    try {
      setIsLoading(true);
      const data = await adminApi.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  return {
    status,
    isAdmin: status?.isAdmin ?? false,
    isLoading,
    error,
    refetch: fetchStatus
  };
}
