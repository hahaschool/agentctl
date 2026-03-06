import { describe, expect, it } from 'vitest';

import {
  ALL_SHORTCUTS,
  CONDENSED_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  NAV_SHORTCUTS,
  type ShortcutEntry,
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
// NAV_SHORTCUTS
// ---------------------------------------------------------------------------

describe('NAV_SHORTCUTS', () => {
  it('is an array of ShortcutEntry objects', () => {
    expect(Array.isArray(NAV_SHORTCUTS)).toBe(true);
    expect(NAV_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('has 7 entries (keys 1-7)', () => {
    expect(NAV_SHORTCUTS).toHaveLength(7);
  });

  it('has entries with numeric keys 1-7', () => {
    const keys = NAV_SHORTCUTS.map((entry) => entry.keys[0]);
    expect(keys).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('has correct descriptions in order', () => {
    const descriptions = NAV_SHORTCUTS.map((entry) => entry.desc);
    expect(descriptions).toEqual([
      'Dashboard',
      'Machines',
      'Agents',
      'Sessions',
      'Discover',
      'Logs & Metrics',
      'Settings',
    ]);
  });

  it('each entry has exactly one key', () => {
    for (const entry of NAV_SHORTCUTS) {
      expect(entry.keys).toHaveLength(1);
    }
  });

  it('each entry has a non-empty description', () => {
    for (const entry of NAV_SHORTCUTS) {
      expect(entry.desc).toBeTruthy();
      expect(entry.desc.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// GLOBAL_SHORTCUTS
// ---------------------------------------------------------------------------

describe('GLOBAL_SHORTCUTS', () => {
  it('is an array of ShortcutEntry objects', () => {
    expect(Array.isArray(GLOBAL_SHORTCUTS)).toBe(true);
    expect(GLOBAL_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('has 5 entries', () => {
    expect(GLOBAL_SHORTCUTS).toHaveLength(5);
  });

  it('contains command palette shortcut (⌘K)', () => {
    const commandPalette = GLOBAL_SHORTCUTS.find((entry) => entry.keys[0]?.includes('⌘'));
    expect(commandPalette).toBeDefined();
    expect(commandPalette?.desc).toBe('Command palette');
  });

  it('contains refresh shortcut (r)', () => {
    const refresh = GLOBAL_SHORTCUTS.find((entry) => entry.keys[0] === 'r');
    expect(refresh).toBeDefined();
    expect(refresh?.desc).toBe('Refresh current page');
  });

  it('contains search focus shortcut (/)', () => {
    const search = GLOBAL_SHORTCUTS.find((entry) => entry.keys[0] === '/');
    expect(search).toBeDefined();
    expect(search?.desc).toBe('Focus search (Discover)');
  });

  it('contains escape shortcut', () => {
    const escapeShortcut = GLOBAL_SHORTCUTS.find((entry) => entry.keys[0] === 'Esc');
    expect(escapeShortcut).toBeDefined();
    expect(escapeShortcut?.desc).toBe('Close panels / Cancel');
  });

  it('contains help toggle shortcut (?)', () => {
    const help = GLOBAL_SHORTCUTS.find((entry) => entry.keys[0] === '?');
    expect(help).toBeDefined();
    expect(help?.desc).toBe('Toggle keyboard help');
  });

  it('each entry has at least one key', () => {
    for (const entry of GLOBAL_SHORTCUTS) {
      expect(entry.keys.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('each entry has a non-empty description', () => {
    for (const entry of GLOBAL_SHORTCUTS) {
      expect(entry.desc).toBeTruthy();
      expect(entry.desc.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ALL_SHORTCUTS
// ---------------------------------------------------------------------------

describe('ALL_SHORTCUTS', () => {
  it('is an array of ShortcutEntry objects', () => {
    expect(Array.isArray(ALL_SHORTCUTS)).toBe(true);
  });

  it('contains all nav shortcuts first', () => {
    const allDescriptions = ALL_SHORTCUTS.map((entry) => entry.desc);
    const navDescriptions = NAV_SHORTCUTS.map((entry) => entry.desc);

    // Check that nav descriptions appear in order at the start
    navDescriptions.forEach((desc, index) => {
      expect(allDescriptions[index]).toBe(desc);
    });
  });

  it('contains all global shortcuts after nav shortcuts', () => {
    const allDescriptions = ALL_SHORTCUTS.map((entry) => entry.desc);
    const globalDescriptions = GLOBAL_SHORTCUTS.map((entry) => entry.desc);
    const offset = NAV_SHORTCUTS.length;

    // Check that global descriptions appear after nav shortcuts
    globalDescriptions.forEach((desc, index) => {
      expect(allDescriptions[offset + index]).toBe(desc);
    });
  });

  it('has 12 total entries (7 nav + 5 global)', () => {
    expect(ALL_SHORTCUTS).toHaveLength(12);
  });

  it('is equal to NAV_SHORTCUTS concatenated with GLOBAL_SHORTCUTS', () => {
    const expected = [...NAV_SHORTCUTS, ...GLOBAL_SHORTCUTS];
    expect(ALL_SHORTCUTS).toEqual(expected);
  });

  it('each entry has a keys array and desc string', () => {
    for (const entry of ALL_SHORTCUTS) {
      expect(Array.isArray(entry.keys)).toBe(true);
      expect(typeof entry.desc).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// CONDENSED_SHORTCUTS
// ---------------------------------------------------------------------------

describe('CONDENSED_SHORTCUTS', () => {
  it('is an array of ShortcutEntry objects', () => {
    expect(Array.isArray(CONDENSED_SHORTCUTS)).toBe(true);
  });

  it('has 6 entries (1 nav + 5 global)', () => {
    expect(CONDENSED_SHORTCUTS).toHaveLength(6);
  });

  it('collapses nav keys 1-7 into a single entry', () => {
    const firstEntry = CONDENSED_SHORTCUTS[0];
    expect(firstEntry?.desc).toBe('Navigate to page');
    expect(firstEntry?.keys[0]).toContain('1');
    expect(firstEntry?.keys[0]).toContain('7');
  });

  it('uses "1–7" (en-dash) for nav range', () => {
    const firstEntry = CONDENSED_SHORTCUTS[0];
    // The character U+2013 is the en-dash (–)
    expect(firstEntry?.keys[0]).toContain('–');
  });

  it('contains all global shortcuts after nav entry', () => {
    const condensedDescriptions = CONDENSED_SHORTCUTS.map((entry) => entry.desc);
    const globalDescriptions = GLOBAL_SHORTCUTS.map((entry) => entry.desc);

    // Skip first entry (nav) and compare the rest
    globalDescriptions.forEach((desc, index) => {
      expect(condensedDescriptions[index + 1]).toBe(desc);
    });
  });

  it('is equal to nav collapsed entry + all global shortcuts', () => {
    const expected = [{ keys: ['1–7'], desc: 'Navigate to page' }, ...GLOBAL_SHORTCUTS];
    expect(CONDENSED_SHORTCUTS).toEqual(expected);
  });

  it('each entry has a keys array and desc string', () => {
    for (const entry of CONDENSED_SHORTCUTS) {
      expect(Array.isArray(entry.keys)).toBe(true);
      expect(typeof entry.desc).toBe('string');
    }
  });

  it('is used in KeyboardHelpOverlay for compact display', () => {
    // This entry count (6) is smaller than ALL_SHORTCUTS (12),
    // making it suitable for a pop-up overlay
    expect(CONDENSED_SHORTCUTS.length).toBeLessThan(ALL_SHORTCUTS.length);
  });
});

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

describe('Shortcut relationships', () => {
  it('CONDENSED_SHORTCUTS has fewer entries than ALL_SHORTCUTS', () => {
    expect(CONDENSED_SHORTCUTS.length).toBeLessThan(ALL_SHORTCUTS.length);
  });

  it('GLOBAL_SHORTCUTS appears in both ALL_SHORTCUTS and CONDENSED_SHORTCUTS', () => {
    // Extract global shortcut descriptions from both arrays
    const allGlobalDescs = ALL_SHORTCUTS.slice(NAV_SHORTCUTS.length).map((entry) => entry.desc);
    const condensedGlobalDescs = CONDENSED_SHORTCUTS.slice(1).map((entry) => entry.desc);
    expect(condensedGlobalDescs).toEqual(allGlobalDescs);
  });

  it('NAV_SHORTCUTS are in ALL_SHORTCUTS but not in CONDENSED_SHORTCUTS', () => {
    const allNavDescs = ALL_SHORTCUTS.slice(0, NAV_SHORTCUTS.length).map((entry) => entry.desc);
    const navDescs = NAV_SHORTCUTS.map((entry) => entry.desc);
    expect(allNavDescs).toEqual(navDescs);

    // CONDENSED_SHORTCUTS should not have individual nav entries
    const condensedNavDescs = CONDENSED_SHORTCUTS.slice(0, NAV_SHORTCUTS.length).map(
      (entry) => entry.desc,
    );
    expect(condensedNavDescs).not.toEqual(navDescs);
  });
});
