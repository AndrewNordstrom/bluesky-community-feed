import type { CSSProperties } from 'react';

interface SkeletonProps {
  variant?: 'text' | 'title' | 'card' | 'stat' | 'slider' | 'button';
  width?: string;
  height?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Skeleton - Animated placeholder for loading states
 *
 * Uses shimmer animation defined in transitions.css
 */
export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  style = {},
}: SkeletonProps) {
  const baseClass = `skeleton skeleton-${variant}`;

  return (
    <div
      className={`${baseClass} ${className}`}
      style={{
        ...(width && { width }),
        ...(height && { height }),
        ...style,
      }}
    />
  );
}

/**
 * VoteSkeleton - Skeleton layout for Vote page
 */
export function VoteSkeleton() {
  return (
    <div className="vote-skeleton" style={{ padding: '24px' }}>
      {/* Epoch status bar */}
      <Skeleton variant="card" height="60px" />

      {/* Tab buttons */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
        <Skeleton variant="button" width="100px" />
        <Skeleton variant="button" width="120px" />
      </div>

      {/* Weight sliders section */}
      <div style={{ marginTop: '32px' }}>
        <Skeleton variant="title" width="30%" />
        <Skeleton variant="text" width="70%" style={{ marginBottom: '24px' }} />

        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            <Skeleton variant="text" width="120px" />
            <Skeleton variant="slider" style={{ flex: 1 }} />
            <Skeleton variant="text" width="50px" />
          </div>
        ))}
      </div>

      {/* Submit button */}
      <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton variant="button" width="140px" height="44px" />
      </div>
    </div>
  );
}

/**
 * DashboardSkeleton - Skeleton layout for Dashboard page
 */
export function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" style={{ padding: '24px' }}>
      {/* Chart and weights section */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
          marginBottom: '32px',
        }}
      >
        <Skeleton variant="card" height="280px" />
        <div>
          <Skeleton variant="title" width="40%" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <Skeleton variant="text" width="100px" />
              <Skeleton variant="text" style={{ flex: 1 }} height="8px" />
              <Skeleton variant="text" width="40px" />
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <Skeleton variant="title" width="25%" style={{ marginBottom: '16px' }} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="stat" />
        ))}
      </div>
    </div>
  );
}

/**
 * HistorySkeleton - Skeleton layout for History page
 */
export function HistorySkeleton() {
  return (
    <div className="history-skeleton" style={{ padding: '24px' }}>
      <Skeleton variant="title" width="30%" style={{ marginBottom: '24px' }} />

      {/* History entries */}
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton
          key={i}
          variant="card"
          height="80px"
          style={{ marginBottom: '12px' }}
        />
      ))}
    </div>
  );
}

/**
 * AdminPanelSkeleton - Skeleton layout for Admin panels
 */
export function AdminPanelSkeleton() {
  return (
    <div className="admin-panel-skeleton">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '16px',
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="card" height="180px" />
        ))}
      </div>
    </div>
  );
}

/**
 * TableSkeleton - Skeleton for table-like content
 */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table-skeleton">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <Skeleton variant="text" width="20%" />
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="text" width="25%" />
        <Skeleton variant="text" width="15%" />
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '12px',
            alignItems: 'center',
          }}
        >
          <Skeleton variant="text" width="20%" />
          <Skeleton variant="text" width="30%" />
          <Skeleton variant="text" width="25%" />
          <Skeleton variant="text" width="15%" />
        </div>
      ))}
    </div>
  );
}
