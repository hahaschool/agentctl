/**
 * Single source of truth for keyboard shortcut definitions displayed in
 * SettingsView and KeyboardHelpOverlay.
 *
 * Navigation shortcuts (1-8) are derived from NAV_ITEMS in Sidebar.tsx at
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

export const KEYBOARD_HELP_OPEN_EVENT = 'agentctl:open-keyboard-help';

/**
 * Navigation page shortcuts (number keys 1-8).
 * Order must match the sidebar nav order.
 */
const NAV_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['1'], desc: 'Dashboard' },
  { keys: ['2'], desc: 'Machines' },
  { keys: ['3'], desc: 'Agents' },
  { keys: ['4'], desc: 'Sessions' },
  { keys: ['5'], desc: 'Discover' },
  { keys: ['6'], desc: 'Logs & Metrics' },
  { keys: ['7'], desc: 'Settings' },
  { keys: ['8'], desc: 'Memory' },
];

/** Global (non-navigation) shortcuts. */
const GLOBAL_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['\u2318K / Ctrl+K'], desc: 'Command palette' },
  { keys: ['\u2318N / Ctrl+N'], desc: 'New agent' },
  { keys: ['\u2318S / Ctrl+S'], desc: 'Save settings' },
  { keys: ['r'], desc: 'Refresh current page' },
  { keys: ['/'], desc: 'Focus page search' },
  { keys: ['Esc'], desc: 'Close dialogs / Cancel' },
  { keys: ['?'], desc: 'Toggle keyboard help' },
];

/**
 * Full shortcut list — nav keys first, then global shortcuts.
 * Used by SettingsView's Keyboard Shortcuts section.
 */
export const ALL_SHORTCUTS: ShortcutEntry[] = [...NAV_SHORTCUTS, ...GLOBAL_SHORTCUTS];

/**
 * "Go to" chord shortcuts — `g` prefix followed by a single letter routes to a
 * nav entry. Pairs with digit shortcuts (1-9, 0) for the most common pages.
 * Keep in sync with NAV_ITEMS.goKey in Sidebar.tsx.
 */
const GO_TO_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['g', 'd'], desc: 'Go to Dashboard' },
  { keys: ['g', 'm'], desc: 'Go to Machines' },
  { keys: ['g', 'a'], desc: 'Go to Agents' },
  { keys: ['g', 'p'], desc: 'Go to Agent Profiles' },
  { keys: ['g', 's'], desc: 'Go to Sessions' },
  { keys: ['g', 'i'], desc: 'Go to Discover' },
  { keys: ['g', 'l'], desc: 'Go to Logs' },
  { keys: ['g', 'e'], desc: 'Go to Settings' },
  { keys: ['g', 'v'], desc: 'Go to Approvals' },
  { keys: ['g', 'y'], desc: 'Go to Memory' },
  { keys: ['g', 'x'], desc: 'Go to Spaces' },
  { keys: ['g', 't'], desc: 'Go to Tasks' },
  { keys: ['g', 'c'], desc: 'Go to Scheduler' },
  { keys: ['g', 'u'], desc: 'Go to Deployment' },
  { keys: ['g', 'f'], desc: 'Go to Conflicts' },
  { keys: ['g', 'n'], desc: 'Go to Mesh Peers' },
  { keys: ['g', 'r'], desc: 'Go to Security' },
  { keys: ['g', 'q'], desc: 'Go to Audit' },
  { keys: ['g', 'w'], desc: 'Go to Webhooks' },
];

/**
 * Grouped shortcuts for the help overlay — organized by context/page.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['?'], desc: 'Show keyboard shortcuts' },
      { keys: ['\u2318K / Ctrl+K'], desc: 'Command palette' },
      { keys: ['\u2318N / Ctrl+N'], desc: 'New agent' },
      { keys: ['\u2318S / Ctrl+S'], desc: 'Save settings (Settings pages)' },
      { keys: ['1\u20139'], desc: 'Navigate to page (top 9)' },
      { keys: ['Esc'], desc: 'Close dialogs / Cancel' },
    ],
  },
  {
    title: 'Go To',
    shortcuts: GO_TO_SHORTCUTS,
  },
  {
    title: 'Sessions',
    shortcuts: [
      { keys: ['r'], desc: 'Refresh' },
      { keys: ['n'], desc: 'New session' },
      { keys: ['/'], desc: 'Focus search' },
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
  {
    title: 'Agent Detail',
    shortcuts: [
      { keys: ['s'], desc: 'Start agent' },
      { keys: ['r'], desc: 'Refresh' },
      { keys: ['e'], desc: 'Open settings' },
    ],
  },
];
