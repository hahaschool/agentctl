'use client';

import { useEffect } from 'react';

type HotkeyHandler = (e: KeyboardEvent) => void;

type HotkeyMap = Record<string, HotkeyHandler>;

/**
 * Register global keyboard shortcuts.
 * Shortcuts are ignored when focus is inside an input, textarea, or select.
 *
 * Keys use a simple format: "slash", "r", "Escape", "shift+?", etc.
 */
export function useHotkeys(hotkeys: HotkeyMap): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Skip when user is typing in a form field
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Build a key string from the event
      let key = e.key;
      if (key === '/') key = 'slash';
      if (key === '?') key = 'shift+?';

      const fn = hotkeys[key] ?? hotkeys[e.key];
      if (fn) {
        fn(e);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [hotkeys]);
}
