import { describe, expect, it } from 'vitest';

import {
  ALL_SHORTCUTS,
  SHORTCUT_GROUPS,
  type ShortcutEntry,
  type ShortcutGroup,
} from './keyboard-shortcuts';

// ---------------------------------------------------------------------------
// ShortcutEntry type
// ---------------------------------------------------------------------------

describe('ShortcutEntry type', () => {
  it('has keys array and desc string', () => {
    const entry: ShortcutEntry = {
      keys: ['1'],
      desc: 'Dashboard',
    };
    expect(entry.keys).toEqual(['1']);
    expect(entry.desc).toBe('Dashboard');
  });

  it('supports multiple keys in array', () => {
    const entry: ShortcutEntry = {
      keys: ['Ctrl', 'K'],
      desc: 'Command palette',
    };
    expect(entry.keys).toHaveLength(2);
    expect(entry.keys[0]).toBe('Ctrl');
  });
});

// ---------------------------------------------------------------------------
// ShortcutGroup type
// ---------------------------------------------------------------------------

describe('ShortcutGroup type', () => {
  it('has title and shortcuts array', () => {
    const group: ShortcutGroup = {
      title: 'Test',
      shortcuts: [{ keys: ['a'], desc: 'Action' }],
    };
    expect(group.title).toBe('Test');
    expect(group.shortcuts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ALL_SHORTCUTS
// ---------------------------------------------------------------------------

describe('ALL_SHORTCUTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(ALL_SHORTCUTS)).toBe(true);
    expect(ALL_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('has 13 total entries (8 nav + 5 global)', () => {
    expect(ALL_SHORTCUTS).toHaveLength(13);
  });

  it('starts with navigation shortcuts (keys 1-8)', () => {
    const navKeys = ALL_SHORTCUTS.slice(0, 8).map((e) => e.keys[0]);
    expect(navKeys).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('has navigation descriptions in correct order', () => {
    const navDescs = ALL_SHORTCUTS.slice(0, 8).map((e) => e.desc);
    expect(navDescs).toEqual([
      'Dashboard',
      'Machines',
      'Agents',
      'Sessions',
      'Discover',
      'Logs & Metrics',
      'Settings',
      'Memory',
    ]);
  });

  it('contains command palette shortcut', () => {
    const cmdK = ALL_SHORTCUTS.find((e) => e.desc === 'Command palette');
    expect(cmdK).toBeDefined();
    expect(cmdK?.keys[0]).toContain('\u2318');
  });

  it('contains refresh, search, escape, and help shortcuts', () => {
    const descs = ALL_SHORTCUTS.map((e) => e.desc);
    expect(descs).toContain('Refresh current page');
    expect(descs).toContain('Focus search (Discover)');
    expect(descs).toContain('Close panels / Cancel');
    expect(descs).toContain('Toggle keyboard help');
  });

  it('each entry has a keys array and desc string', () => {
    for (const entry of ALL_SHORTCUTS) {
      expect(Array.isArray(entry.keys)).toBe(true);
      expect(entry.keys.length).toBeGreaterThanOrEqual(1);
      expect(typeof entry.desc).toBe('string');
      expect(entry.desc.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// SHORTCUT_GROUPS
// ---------------------------------------------------------------------------

describe('SHORTCUT_GROUPS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SHORTCUT_GROUPS)).toBe(true);
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
  });

  it('has 4 groups: Global, Sessions, Session Detail, Agents', () => {
    const titles = SHORTCUT_GROUPS.map((g) => g.title);
    expect(titles).toEqual(['Global', 'Sessions', 'Session Detail', 'Agents']);
  });

  it('Global group contains navigation and command palette shortcuts', () => {
    const global = SHORTCUT_GROUPS.find((g) => g.title === 'Global');
    expect(global).toBeDefined();
    const descs = global?.shortcuts.map((s) => s.desc) ?? [];
    expect(descs).toContain('Command palette');
    expect(descs).toContain('Navigate to page');
    expect(descs).toContain('Show keyboard shortcuts');
  });

  it('Sessions group contains relevant shortcuts', () => {
    const sessions = SHORTCUT_GROUPS.find((g) => g.title === 'Sessions');
    expect(sessions).toBeDefined();
    const descs = sessions?.shortcuts.map((s) => s.desc) ?? [];
    expect(descs).toContain('Refresh');
    expect(descs).toContain('New session');
    expect(descs).toContain('Navigate list');
  });

  it('Session Detail group contains export and toggle shortcuts', () => {
    const detail = SHORTCUT_GROUPS.find((g) => g.title === 'Session Detail');
    expect(detail).toBeDefined();
    const descs = detail?.shortcuts.map((s) => s.desc) ?? [];
    expect(descs).toContain('Export as JSON');
    expect(descs).toContain('Export as Markdown');
    expect(descs).toContain('Toggle terminal view');
    expect(descs).toContain('Toggle file browser');
    expect(descs).toContain('Search messages');
  });

  it('Agents group contains agent-specific shortcuts', () => {
    const agents = SHORTCUT_GROUPS.find((g) => g.title === 'Agents');
    expect(agents).toBeDefined();
    const descs = agents?.shortcuts.map((s) => s.desc) ?? [];
    expect(descs).toContain('Refresh');
    expect(descs).toContain('New agent');
    expect(descs).toContain('Close dialog');
  });

  it('every group has at least one shortcut', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it('every shortcut in every group has valid structure', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(typeof group.title).toBe('string');
      for (const shortcut of group.shortcuts) {
        expect(Array.isArray(shortcut.keys)).toBe(true);
        expect(shortcut.keys.length).toBeGreaterThanOrEqual(1);
        expect(typeof shortcut.desc).toBe('string');
      }
    }
  });

  it('two-key shortcuts use separate array entries', () => {
    const global = SHORTCUT_GROUPS.find((g) => g.title === 'Global');
    const goToDashboard = global?.shortcuts.find((s) => s.desc === 'Go to Dashboard');
    expect(goToDashboard).toBeDefined();
    expect(goToDashboard?.keys).toEqual(['g', 'd']);
  });
});
