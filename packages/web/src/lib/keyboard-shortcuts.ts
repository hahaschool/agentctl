/**
 * Single source of truth for keyboard shortcut definitions displayed in
 * SettingsView and KeyboardHelpOverlay.
 *
 * Navigation shortcuts (1-7) are derived from NAV_ITEMS in Sidebar.tsx at
 * runtime, but the "shape" metadata lives here so every display surface stays
 * in sync.
 */

export type ShortcutEntry = {
  /** Keys to render inside <kbd> elements (e.g. ['\u2318K'] or ['1'] ) */
  keys: string[];
  /** Human-readable description */
  desc: string;
};

/**
 * Navigation page shortcuts (number keys 1-7).
 * Order must match the sidebar nav order.
 */
export const NAV_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['1'], desc: 'Dashboard' },
  { keys: ['2'], desc: 'Machines' },
  { keys: ['3'], desc: 'Agents' },
  { keys: ['4'], desc: 'Sessions' },
  { keys: ['5'], desc: 'Discover' },
  { keys: ['6'], desc: 'Logs & Metrics' },
  { keys: ['7'], desc: 'Settings' },
];

/** Global (non-navigation) shortcuts. */
export const GLOBAL_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['\u2318K'], desc: 'Command palette' },
  { keys: ['r'], desc: 'Refresh current page' },
  { keys: ['/'], desc: 'Focus search (Discover)' },
  { keys: ['Esc'], desc: 'Close panels / Cancel' },
  { keys: ['?'], desc: 'Toggle keyboard help' },
];

/**
 * Full shortcut list — nav keys first, then global shortcuts.
 * Used by SettingsView's Keyboard Shortcuts section.
 */
export const ALL_SHORTCUTS: ShortcutEntry[] = [...NAV_SHORTCUTS, ...GLOBAL_SHORTCUTS];

/**
 * Condensed shortcut list — nav keys collapsed into a single "1-7" entry.
 * Used by the KeyboardHelpOverlay (the `?` pop-up).
 */
export const CONDENSED_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['1\u20137'], desc: 'Navigate to page' },
  ...GLOBAL_SHORTCUTS,
];
