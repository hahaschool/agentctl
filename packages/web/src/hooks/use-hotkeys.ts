'use client';

import { useEffect } from 'react';

type HotkeyHandler = (e: KeyboardEvent) => void;

type HotkeyMap = Record<string, HotkeyHandler>;

type UseHotkeysOptions = {
  /** When true, hotkeys can fire while focus is inside inputs/textareas/selects/contenteditable. */
  enableOnFormTags?: boolean;
};

function normalizeKey(rawKey: string): string {
  if (rawKey === '/') return 'slash';
  if (rawKey.length === 1) return rawKey.toLowerCase();
  return rawKey;
}

function isFormTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const maybeElement = target as { tagName?: string; isContentEditable?: boolean };
  const tag = maybeElement.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    maybeElement.isContentEditable === true
  );
}

function getHotkeyVariants(e: KeyboardEvent): string[] {
  const key = normalizeKey(e.key);
  const keys = new Set<string>([e.key, key]);

  if (e.key === '?') {
    keys.add('shift+?');
  }

  if (e.metaKey || e.ctrlKey) {
    keys.add(`mod+${key}`);
  }
  if (e.metaKey) {
    keys.add(`cmd+${key}`);
    keys.add(`meta+${key}`);
  }
  if (e.ctrlKey) {
    keys.add(`ctrl+${key}`);
  }
  if (e.altKey) {
    keys.add(`alt+${key}`);
  }
  if (e.shiftKey) {
    keys.add(`shift+${key}`);
  }

  return Array.from(keys);
}

/**
 * Register global keyboard shortcuts.
 * Shortcuts are ignored when focus is inside an input, textarea, or select.
 *
 * Keys use a simple format: "slash", "r", "Escape", "shift+?", "mod+k", etc.
 */
export function useHotkeys(hotkeys: HotkeyMap, options?: UseHotkeysOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!options?.enableOnFormTags && isFormTarget(e.target)) return;

      for (const key of getHotkeyVariants(e)) {
        const fn = hotkeys[key];
        if (fn) {
          fn(e);
          return;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [hotkeys, options?.enableOnFormTags]);
}
