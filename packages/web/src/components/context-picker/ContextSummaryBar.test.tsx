import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component import
// ---------------------------------------------------------------------------

import { ContextSummaryBar } from './ContextSummaryBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderOpts = {
  selectedCount?: number;
  estimatedTokens?: number;
  hideToolResults?: boolean;
  collapseThinking?: boolean;
  onToggleHideToolResults?: () => void;
  onToggleCollapseThinking?: () => void;
};

function renderBar(opts: RenderOpts = {}) {
  const onToggleHideToolResults = opts.onToggleHideToolResults ?? vi.fn();
  const onToggleCollapseThinking = opts.onToggleCollapseThinking ?? vi.fn();

  const result = render(
    <ContextSummaryBar
      selectedCount={opts.selectedCount ?? 42}
      estimatedTokens={opts.estimatedTokens ?? 15000}
      hideToolResults={opts.hideToolResults ?? false}
      collapseThinking={opts.collapseThinking ?? false}
      onToggleHideToolResults={onToggleHideToolResults}
      onToggleCollapseThinking={onToggleCollapseThinking}
    />,
  );

  return { ...result, onToggleHideToolResults, onToggleCollapseThinking };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('ContextSummaryBar', () => {
  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('shows selected count, token count, and cost estimate', () => {
      renderBar({ selectedCount: 42, estimatedTokens: 15000 });

      expect(screen.getByText('42')).toBeDefined();
      expect(screen.getByText(/selected/)).toBeDefined();
      expect(screen.getByText('~15.0k')).toBeDefined();
      expect(screen.getByText(/tokens/)).toBeDefined();
      // Cost: 15000 * 0.003 / 1000 = 0.045 → "$0.05" via toFixed(2)
      // The "~" prefix and cost are in the same span
      const statsDiv = screen.getByText(/selected/).closest('div');
      expect(statsDiv?.textContent).toContain('est.');
    });

    it('shows exact token count below 1000', () => {
      renderBar({ estimatedTokens: 500 });
      expect(screen.getByText('500')).toBeDefined();
    });

    it('shows zero cost for zero tokens', () => {
      renderBar({ selectedCount: 0, estimatedTokens: 0 });
      // Both selectedCount and tokens are "0" — use getAllByText
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBe(2);
      // Cost shown in the stats div
      const statsDiv = screen.getByText(/selected/).closest('div');
      expect(statsDiv?.textContent).toContain('$0.00');
    });

    it('renders both toggle buttons', () => {
      renderBar();
      expect(screen.getByText('Hide tool results')).toBeDefined();
      expect(screen.getByText('Collapse thinking')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Cost calculation
  // -----------------------------------------------------------------------

  describe('cost calculation', () => {
    it('calculates cost as tokens * 0.003 / 1000', () => {
      // 100000 * 0.003 / 1000 = 0.30
      renderBar({ estimatedTokens: 100000 });
      expect(screen.getByText('~$0.30', { exact: true })).toBeDefined();
    });

    it('calculates cost for small token count', () => {
      // 1000 * 0.003 / 1000 = 0.003 → $0.00
      renderBar({ estimatedTokens: 1000 });
      const statsDiv = screen.getByText(/selected/).closest('div');
      expect(statsDiv?.textContent).toContain('~$0.00');
    });

    it('calculates cost for large token count', () => {
      // 500000 * 0.003 / 1000 = 1.50
      renderBar({ estimatedTokens: 500000 });
      expect(screen.getByText('~$1.50', { exact: true })).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Toggle active states
  // -----------------------------------------------------------------------

  describe('toggle states', () => {
    it('hideToolResults active: shows blue styling', () => {
      renderBar({ hideToolResults: true });
      const btn = screen.getByText('Hide tool results');
      expect(btn.className).toContain('bg-blue-500/20');
      expect(btn.className).toContain('text-blue-600');
    });

    it('hideToolResults inactive: shows muted styling', () => {
      renderBar({ hideToolResults: false });
      const btn = screen.getByText('Hide tool results');
      expect(btn.className).toContain('bg-muted');
      expect(btn.className).toContain('text-muted-foreground');
    });

    it('collapseThinking active: shows blue styling', () => {
      renderBar({ collapseThinking: true });
      const btn = screen.getByText('Collapse thinking');
      expect(btn.className).toContain('bg-blue-500/20');
      expect(btn.className).toContain('text-blue-600');
    });

    it('collapseThinking inactive: shows muted styling', () => {
      renderBar({ collapseThinking: false });
      const btn = screen.getByText('Collapse thinking');
      expect(btn.className).toContain('bg-muted');
      expect(btn.className).toContain('text-muted-foreground');
    });

    it('both toggles can be active simultaneously', () => {
      renderBar({ hideToolResults: true, collapseThinking: true });
      const hideBtn = screen.getByText('Hide tool results');
      const collapseBtn = screen.getByText('Collapse thinking');
      expect(hideBtn.className).toContain('bg-blue-500/20');
      expect(collapseBtn.className).toContain('bg-blue-500/20');
    });
  });

  // -----------------------------------------------------------------------
  // Interactions
  // -----------------------------------------------------------------------

  describe('interactions', () => {
    it('clicking "Hide tool results" calls onToggleHideToolResults', () => {
      const onToggleHideToolResults = vi.fn();
      renderBar({ onToggleHideToolResults });

      fireEvent.click(screen.getByText('Hide tool results'));
      expect(onToggleHideToolResults).toHaveBeenCalledTimes(1);
    });

    it('clicking "Collapse thinking" calls onToggleCollapseThinking', () => {
      const onToggleCollapseThinking = vi.fn();
      renderBar({ onToggleCollapseThinking });

      fireEvent.click(screen.getByText('Collapse thinking'));
      expect(onToggleCollapseThinking).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Token formatting
  // -----------------------------------------------------------------------

  describe('token formatting', () => {
    it('formats tokens < 1000 as exact number', () => {
      renderBar({ estimatedTokens: 999 });
      expect(screen.getByText('999')).toBeDefined();
    });

    it('formats tokens >= 1000 as ~X.Xk', () => {
      renderBar({ estimatedTokens: 2500 });
      expect(screen.getByText('~2.5k')).toBeDefined();
    });

    it('formats exactly 1000 as ~1.0k', () => {
      renderBar({ estimatedTokens: 1000 });
      expect(screen.getByText('~1.0k')).toBeDefined();
    });
  });
});
