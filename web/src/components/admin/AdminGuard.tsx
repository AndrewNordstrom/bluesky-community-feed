/**
 * AdminGuard Component
 *
 * Protects admin routes by checking authentication and admin status.
 * Redirects to home if user is not authenticated or not an admin.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { useAdminStatus } from '../../hooks/useAdminStatus';

interface AdminGuardProps {
  children: ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading, error } = useAdminStatus();

  // Show loading state
  if (authLoading || adminLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner" />
        <p>Checking access...</p>
      </div>
    );
  }

  // Redirect if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Redirect if not admin
  if (!isAdmin || error) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
