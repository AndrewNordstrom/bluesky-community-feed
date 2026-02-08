import type { ReactNode } from 'react';
import { useEffect, useState, useRef } from 'react';

interface TabPanelProps {
  children: ReactNode;
  isActive: boolean;
  tabKey: string;
}

/**
 * TabPanel - Wraps tab content with smooth fade transitions
 *
 * Usage:
 *   <TabPanel isActive={activeTab === 'settings'} tabKey="settings">
 *     <SettingsContent />
 *   </TabPanel>
 */
export function TabPanel({ children, isActive, tabKey }: TabPanelProps) {
  const [shouldRender, setShouldRender] = useState(isActive);
  const [animationKey, setAnimationKey] = useState(0);
  const prevActiveRef = useRef(isActive);

  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      // Tab becoming active - render and trigger animation
      setShouldRender(true);
      setAnimationKey(k => k + 1);
    } else if (!isActive && prevActiveRef.current) {
      // Tab becoming inactive - unmount after brief delay
      const timer = setTimeout(() => setShouldRender(false), 50);
      return () => clearTimeout(timer);
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  // Don't render if not active and shouldn't render
  if (!shouldRender && !isActive) return null;

  return (
    <div
      key={animationKey}
      className="tab-content"
      style={{ display: isActive ? 'block' : 'none' }}
      role="tabpanel"
      aria-hidden={!isActive}
      data-tab-key={tabKey}
    >
      {children}
    </div>
  );
}
