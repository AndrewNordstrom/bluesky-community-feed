import type { ReactNode } from 'react';

interface TabPanelProps {
  children: ReactNode;
  isActive: boolean;
  tabKey: string;
  keepMounted?: boolean;
}

/**
 * TabPanel - Lazy mounts once and keeps inactive tabs mounted.
 * This avoids remount flicker and preserves local state between tab switches.
 */
export function TabPanel({ children, isActive, tabKey, keepMounted = true }: TabPanelProps) {
  if (!keepMounted && !isActive) {
    return null;
  }

  return (
    <div
      className={`tab-content ${isActive ? 'active' : 'inactive'}`}
      role="tabpanel"
      aria-hidden={!isActive}
      data-tab-key={tabKey}
    >
      {children}
    </div>
  );
}
