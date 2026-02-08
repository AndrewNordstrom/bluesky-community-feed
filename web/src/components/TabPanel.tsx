import type { ReactNode, CSSProperties } from 'react';
import { useEffect, useState, useRef } from 'react';

interface TabPanelProps {
  children: ReactNode;
  isActive: boolean;
  tabKey: string;
}

/**
 * TabPanel - Wraps tab content with smooth fade transitions
 *
 * Uses CSS opacity transitions for smooth fade in/out effect
 * when switching between tabs.
 */
export function TabPanel({ children, isActive, tabKey }: TabPanelProps) {
  const [shouldRender, setShouldRender] = useState(isActive);
  const [isVisible, setIsVisible] = useState(isActive);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (isActive) {
      // Tab becoming active - render immediately, then fade in
      setShouldRender(true);
      // Small delay to ensure DOM is ready before triggering transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      // Tab becoming inactive - fade out, then unmount
      setIsVisible(false);
      timeoutRef.current = setTimeout(() => {
        setShouldRender(false);
      }, 200); // Match the CSS transition duration
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isActive]);

  if (!shouldRender) return null;

  const style: CSSProperties = {
    opacity: isVisible ? 1 : 0,
    transition: 'opacity 200ms ease-out',
    // Prevent layout shift during transition
    ...(isActive ? {} : { position: 'absolute' as const, pointerEvents: 'none' as const }),
  };

  return (
    <div
      className="tab-content"
      style={style}
      role="tabpanel"
      aria-hidden={!isActive}
      data-tab-key={tabKey}
    >
      {children}
    </div>
  );
}
