import { describe, expect, it } from 'vitest';
import { TERMINAL_FONT_FAMILY, TERMINAL_THEME } from './terminal-theme';

describe('terminal-theme', () => {
  describe('TERMINAL_THEME', () => {
    it('has a background color', () => {
      expect(TERMINAL_THEME.background).toBe('#0a0a0a');
    });

    it('has a foreground color', () => {
      expect(TERMINAL_THEME.foreground).toBe('#e4e4e7');
    });

    it('has all 8 standard ANSI colors', () => {
      expect(TERMINAL_THEME.black).toBeDefined();
      expect(TERMINAL_THEME.red).toBeDefined();
      expect(TERMINAL_THEME.green).toBeDefined();
      expect(TERMINAL_THEME.yellow).toBeDefined();
      expect(TERMINAL_THEME.blue).toBeDefined();
      expect(TERMINAL_THEME.magenta).toBeDefined();
      expect(TERMINAL_THEME.cyan).toBeDefined();
      expect(TERMINAL_THEME.white).toBeDefined();
    });

    it('has all 8 bright ANSI colors', () => {
      expect(TERMINAL_THEME.brightBlack).toBeDefined();
      expect(TERMINAL_THEME.brightRed).toBeDefined();
      expect(TERMINAL_THEME.brightGreen).toBeDefined();
      expect(TERMINAL_THEME.brightYellow).toBeDefined();
      expect(TERMINAL_THEME.brightBlue).toBeDefined();
      expect(TERMINAL_THEME.brightMagenta).toBeDefined();
      expect(TERMINAL_THEME.brightCyan).toBeDefined();
      expect(TERMINAL_THEME.brightWhite).toBeDefined();
    });

    it('has cursor and selection colors', () => {
      expect(TERMINAL_THEME.cursor).toBe('#e4e4e7');
      expect(TERMINAL_THEME.selectionBackground).toBe('#3f3f46');
    });

    it('all color values are valid hex strings', () => {
      for (const [, value] of Object.entries(TERMINAL_THEME)) {
        if (typeof value === 'string') {
          expect(value).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });
  });

  describe('TERMINAL_FONT_FAMILY', () => {
    it('is a non-empty string', () => {
      expect(typeof TERMINAL_FONT_FAMILY).toBe('string');
      expect(TERMINAL_FONT_FAMILY.length).toBeGreaterThan(0);
    });

    it('includes ui-monospace as the first font', () => {
      expect(TERMINAL_FONT_FAMILY.startsWith('ui-monospace')).toBe(true);
    });

    it('includes common monospace fallback fonts', () => {
      expect(TERMINAL_FONT_FAMILY).toContain('Menlo');
      expect(TERMINAL_FONT_FAMILY).toContain('Monaco');
      expect(TERMINAL_FONT_FAMILY).toContain('Consolas');
      expect(TERMINAL_FONT_FAMILY).toContain('monospace');
    });
  });
});
