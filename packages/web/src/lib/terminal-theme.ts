/** Shared xterm.js terminal configuration used by TerminalView and InteractiveTerminal. */

import type { ITheme } from '@xterm/xterm';

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
