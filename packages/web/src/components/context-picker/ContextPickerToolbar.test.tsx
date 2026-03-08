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

import { ContextPickerToolbar } from './ContextPickerToolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderOpts = {
  totalMessages?: number;
  selectedCount?: number;
  estimatedTokens?: number;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  filterType?: string;
  onFilterChange?: (type: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onInvert?: () => void;
};

function renderToolbar(opts: RenderOpts = {}) {
  const onSearchChange = opts.onSearchChange ?? vi.fn();
  const onFilterChange = opts.onFilterChange ?? vi.fn();
  const onSelectAll = opts.onSelectAll ?? vi.fn();
  const onDeselectAll = opts.onDeselectAll ?? vi.fn();
  const onInvert = opts.onInvert ?? vi.fn();

  const result = render(
    <ContextPickerToolbar
      totalMessages={opts.totalMessages ?? 847}
      selectedCount={opts.selectedCount ?? 234}
      estimatedTokens={opts.estimatedTokens ?? 48200}
      searchQuery={opts.searchQuery ?? ''}
      onSearchChange={onSearchChange}
      filterType={opts.filterType ?? ''}
      onFilterChange={onFilterChange}
      onSelectAll={onSelectAll}
      onDeselectAll={onDeselectAll}
      onInvert={onInvert}
    />,
  );

  return { ...result, onSearchChange, onFilterChange, onSelectAll, onDeselectAll, onInvert };
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

describe('ContextPickerToolbar', () => {
  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('renders search input, filter dropdown, and buttons', () => {
      renderToolbar();

      expect(screen.getByLabelText('Search messages')).toBeDefined();
      expect(screen.getByLabelText('Filter by type')).toBeDefined();
      expect(screen.getByText('Select All')).toBeDefined();
      expect(screen.getByText('Deselect All')).toBeDefined();
      expect(screen.getByText('Invert')).toBeDefined();
    });

    it('shows filter dropdown with all type options', () => {
      renderToolbar();
      const select = screen.getByLabelText('Filter by type') as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(options).toEqual(['All', 'User', 'Assistant', 'Tool Call', 'Tool Result', 'Thinking']);
    });

    it('shows correct counts in stats row', () => {
      renderToolbar({ totalMessages: 847, selectedCount: 234, estimatedTokens: 48200 });

      expect(screen.getByText('847 messages')).toBeDefined();
      expect(screen.getByText('234 selected')).toBeDefined();
      expect(screen.getByText('~48.2k tokens')).toBeDefined();
    });

    it('shows search query value in input', () => {
      renderToolbar({ searchQuery: 'hello' });
      const input = screen.getByLabelText('Search messages') as HTMLInputElement;
      expect(input.value).toBe('hello');
    });

    it('shows selected filter type', () => {
      renderToolbar({ filterType: 'human' });
      const select = screen.getByLabelText('Filter by type') as HTMLSelectElement;
      expect(select.value).toBe('human');
    });
  });

  // -----------------------------------------------------------------------
  // Interactions
  // -----------------------------------------------------------------------

  describe('interactions', () => {
    it('search input change calls onSearchChange', () => {
      const onSearchChange = vi.fn();
      renderToolbar({ onSearchChange });

      const input = screen.getByLabelText('Search messages');
      fireEvent.change(input, { target: { value: 'test query' } });
      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('test query');
    });

    it('filter change calls onFilterChange', () => {
      const onFilterChange = vi.fn();
      renderToolbar({ onFilterChange });

      const select = screen.getByLabelText('Filter by type');
      fireEvent.change(select, { target: { value: 'assistant' } });
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      expect(onFilterChange).toHaveBeenCalledWith('assistant');
    });

    it('Select All button calls onSelectAll', () => {
      const onSelectAll = vi.fn();
      renderToolbar({ onSelectAll });

      fireEvent.click(screen.getByText('Select All'));
      expect(onSelectAll).toHaveBeenCalledTimes(1);
    });

    it('Deselect All button calls onDeselectAll', () => {
      const onDeselectAll = vi.fn();
      renderToolbar({ onDeselectAll });

      fireEvent.click(screen.getByText('Deselect All'));
      expect(onDeselectAll).toHaveBeenCalledTimes(1);
    });

    it('Invert button calls onInvert', () => {
      const onInvert = vi.fn();
      renderToolbar({ onInvert });

      fireEvent.click(screen.getByText('Invert'));
      expect(onInvert).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Token formatting
  // -----------------------------------------------------------------------

  describe('token formatting', () => {
    it('shows exact count below 1000', () => {
      renderToolbar({ estimatedTokens: 500 });
      expect(screen.getByText('500 tokens')).toBeDefined();
    });

    it('shows ~X.Xk for tokens >= 1000', () => {
      renderToolbar({ estimatedTokens: 1500 });
      expect(screen.getByText('~1.5k tokens')).toBeDefined();
    });

    it('shows ~X.Xk for exactly 1000', () => {
      renderToolbar({ estimatedTokens: 1000 });
      expect(screen.getByText('~1.0k tokens')).toBeDefined();
    });

    it('shows 0 for zero tokens', () => {
      renderToolbar({ estimatedTokens: 0 });
      expect(screen.getByText('0 tokens')).toBeDefined();
    });

    it('shows ~100.0k for large values', () => {
      renderToolbar({ estimatedTokens: 100000 });
      expect(screen.getByText('~100.0k tokens')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Token color
  // -----------------------------------------------------------------------

  describe('token color', () => {
    it('green for tokens < 50000', () => {
      const { container } = renderToolbar({ estimatedTokens: 30000 });
      const tokenEl = container.querySelector('.text-green-500');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl?.textContent).toContain('~30.0k tokens');
    });

    it('yellow for tokens >= 50000 and < 100000', () => {
      const { container } = renderToolbar({ estimatedTokens: 75000 });
      const tokenEl = container.querySelector('.text-yellow-500');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl?.textContent).toContain('~75.0k tokens');
    });

    it('red for tokens >= 100000', () => {
      const { container } = renderToolbar({ estimatedTokens: 150000 });
      const tokenEl = container.querySelector('.text-red-500');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl?.textContent).toContain('~150.0k tokens');
    });

    it('green for zero tokens', () => {
      const { container } = renderToolbar({ estimatedTokens: 0 });
      const tokenEl = container.querySelector('.text-green-500');
      expect(tokenEl).not.toBeNull();
    });

    it('yellow at exact boundary of 50000', () => {
      const { container } = renderToolbar({ estimatedTokens: 50000 });
      const tokenEl = container.querySelector('.text-yellow-500');
      expect(tokenEl).not.toBeNull();
    });

    it('red at exact boundary of 100000', () => {
      const { container } = renderToolbar({ estimatedTokens: 100000 });
      const tokenEl = container.querySelector('.text-red-500');
      expect(tokenEl).not.toBeNull();
    });
  });
});
