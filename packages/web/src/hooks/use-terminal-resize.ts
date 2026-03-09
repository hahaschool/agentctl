import type { RefObject } from 'react';
import { useCallback, useEffect } from 'react';

/**
 * Shared resize logic for xterm.js terminal components.
 * Handles window resize, initial fit, and ResizeObserver on parent element.
 */
export function useTerminalResize(
  fitAddonRef: RefObject<import('@xterm/addon-fit').FitAddon | null>,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  const handleResize = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // Terminal may not be ready yet
    }
  }, [fitAddonRef]);

  // Window resize + initial delayed fit
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [handleResize]);

  // ResizeObserver on parent element
  useEffect(() => {
    const observer = new ResizeObserver(() => handleResize());
    if (containerRef.current?.parentElement) {
      observer.observe(containerRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, [handleResize, containerRef]);
}
