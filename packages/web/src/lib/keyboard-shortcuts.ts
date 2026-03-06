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

export type ShortcutGroup = {
  /** Section heading */
  title: string;
  /** Shortcuts in this group */
  shortcuts: ShortcutEntry[];
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

/**
 * Grouped shortcuts for the help overlay — organized by context/page.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['?'], desc: 'Show keyboard shortcuts' },
      { keys: ['\u2318K'], desc: 'Command palette' },
      { keys: ['1\u20137'], desc: 'Navigate to page' },
      { keys: ['Esc'], desc: 'Close panels / Cancel' },
      { keys: ['g', 'd'], desc: 'Go to Dashboard' },
      { keys: ['g', 's'], desc: 'Go to Sessions' },
      { keys: ['g', 'a'], desc: 'Go to Agents' },
      { keys: ['g', 'm'], desc: 'Go to Machines' },
    ],
  },
  {
    title: 'Sessions',
    shortcuts: [
      { keys: ['r'], desc: 'Refresh' },
      { keys: ['n'], desc: 'New session' },
      { keys: ['\u2191', '\u2193'], desc: 'Navigate list' },
      { keys: ['\u23CE'], desc: 'Open selected' },
      { keys: ['Esc'], desc: 'Back' },
    ],
  },
  {
    title: 'Session Detail',
    shortcuts: [
      { keys: ['r'], desc: 'Refresh' },
      { keys: ['\u2318F'], desc: 'Search messages' },
      { keys: ['f'], desc: 'Toggle file browser' },
      { keys: ['t'], desc: 'Toggle terminal view' },
      { keys: ['e'], desc: 'Export as JSON' },
      { keys: ['m'], desc: 'Export as Markdown' },
      { keys: ['Esc'], desc: 'Close panels / search' },
    ],
  },
  {
    title: 'Agents',
    shortcuts: [
      { keys: ['r'], desc: 'Refresh' },
      { keys: ['n'], desc: 'New agent' },
      { keys: ['Esc'], desc: 'Close dialog' },
    ],
  },
];
