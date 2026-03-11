/** Shared xterm.js terminal configuration used by TerminalView and InteractiveTerminal. */

import type { ITheme } from '@xterm/xterm';

/**
 * Reads a CSS custom property from the document root.
 * Falls back to the provided default if the variable is not set or we are in SSR.
 */
function getCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Build the xterm.js theme from CSS custom properties defined in globals.css.
 * Call this when mounting a terminal instance so it picks up the current
 * light/dark theme values.
 */
export function getTerminalTheme(): ITheme {
  return {
    background: getCssVar('--color-terminal-bg', '#0a0a0a'),
    foreground: getCssVar('--color-terminal-fg', '#e4e4e7'),
    cursor: getCssVar('--color-terminal-cursor', '#e4e4e7'),
    selectionBackground: getCssVar('--color-terminal-selection', '#3f3f46'),
    black: getCssVar('--color-terminal-black', '#09090b'),
    red: getCssVar('--color-terminal-red', '#ef4444'),
    green: getCssVar('--color-terminal-green', '#22c55e'),
    yellow: getCssVar('--color-terminal-yellow', '#eab308'),
    blue: getCssVar('--color-terminal-blue', '#3b82f6'),
    magenta: getCssVar('--color-terminal-magenta', '#a855f7'),
    cyan: getCssVar('--color-terminal-cyan', '#06b6d4'),
    white: getCssVar('--color-terminal-white', '#e4e4e7'),
    brightBlack: getCssVar('--color-terminal-bright-black', '#52525b'),
    brightRed: getCssVar('--color-terminal-bright-red', '#f87171'),
    brightGreen: getCssVar('--color-terminal-bright-green', '#4ade80'),
    brightYellow: getCssVar('--color-terminal-bright-yellow', '#facc15'),
    brightBlue: getCssVar('--color-terminal-bright-blue', '#60a5fa'),
    brightMagenta: getCssVar('--color-terminal-bright-magenta', '#c084fc'),
    brightCyan: getCssVar('--color-terminal-bright-cyan', '#22d3ee'),
    brightWhite: getCssVar('--color-terminal-bright-white', '#fafafa'),
  };
}

/**
 * Static fallback theme for contexts where CSS variables are unavailable (SSR, tests).
 * Matches the dark-theme defaults from globals.css.
 */
export const TERMINAL_THEME: ITheme = {
  background: '#0a0a0a',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  selectionBackground: '#3f3f46',
  black: '#09090b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
};

export const TERMINAL_FONT_FAMILY =
  'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace';
