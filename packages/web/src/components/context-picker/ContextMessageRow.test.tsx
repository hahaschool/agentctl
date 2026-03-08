import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/message-styles', () => ({
  getMessageStyle: (type: string) => {
    const styles: Record<string, { label: string; textClass: string; bubbleClass: string }> = {
      human: { label: 'You', textClass: 'text-indigo-400', bubbleClass: '' },
      assistant: { label: 'Claude', textClass: 'text-green-400', bubbleClass: '' },
      tool_use: { label: 'Tool Call', textClass: 'text-yellow-400', bubbleClass: '' },
      tool_result: { label: 'Tool Result', textClass: 'text-slate-400', bubbleClass: '' },
      thinking: { label: 'Thinking', textClass: 'text-purple-400', bubbleClass: '' },
    };
    return styles[type] ?? { label: type, textClass: 'text-muted-foreground', bubbleClass: '' };
  },
}));

// ---------------------------------------------------------------------------
// Component import
// ---------------------------------------------------------------------------

import type { SessionContentMessage } from '@/lib/api';
import { ContextMessageRow } from './ContextMessageRow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<SessionContentMessage> = {}): SessionContentMessage {
  return {
    type: 'human',
    content: 'Hello, world!',
    timestamp: '2026-03-06T14:30:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderOpts = {
  message?: SessionContentMessage;
  index?: number;
  checked?: boolean;
  onToggle?: (index: number) => void;
  onForkHere?: (index: number) => void;
  onShiftClick?: (index: number) => void;
  style?: React.CSSProperties;
};

function renderRow(opts: RenderOpts = {}) {
  const message = opts.message ?? makeMessage();
  const index = opts.index ?? 0;
  const checked = opts.checked ?? true;
  const onToggle = opts.onToggle ?? vi.fn();
  const onForkHere = opts.onForkHere ?? vi.fn();
  const onShiftClick = opts.onShiftClick ?? vi.fn();
  const style = opts.style;

  const result = render(
    <ContextMessageRow
      message={message}
      index={index}
      checked={checked}
      onToggle={onToggle}
      onForkHere={onForkHere}
      onShiftClick={onShiftClick}
      style={style}
    />,
  );

  return { ...result, onToggle, onForkHere, onShiftClick, message };
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

describe('ContextMessageRow', () => {
  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('renders checkbox, type label, content, and time', () => {
      renderRow({
        message: makeMessage({
          type: 'human',
          content: 'Test content',
          timestamp: '2026-03-06T14:30:00Z',
        }),
        index: 0,
      });

      // Checkbox
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeDefined();

      // Type label
      expect(screen.getByText('You')).toBeDefined();

      // Content
      expect(screen.getByText('Test content')).toBeDefined();

      // Time — formatTime produces HH:MM in local timezone
      // We verify a time-like string is present
      const timeEl = screen.getByText(/^\d{2}:\d{2}$/);
      expect(timeEl).toBeDefined();
    });

    it('shows tool name when present', () => {
      renderRow({
        message: makeMessage({ type: 'tool_use', toolName: 'Read' }),
      });

      expect(screen.getByText('Tool Call')).toBeDefined();
      expect(screen.getByText('Read')).toBeDefined();
    });

    it('does not show time when timestamp is undefined', () => {
      const { container } = renderRow({
        message: makeMessage({ timestamp: undefined }),
      });

      // No element with time pattern
      const timeElements = container.querySelectorAll('.text-muted-foreground\\/60');
      expect(timeElements.length).toBe(0);
    });

    it('applies checked styles when checked=true', () => {
      const { container } = renderRow({ checked: true });
      const row = container.firstElementChild;
      expect(row?.className).toContain('bg-muted/50');
      expect(row?.className).toContain('border-l-blue-500');
    });

    it('applies unchecked styles when checked=false', () => {
      const { container } = renderRow({ checked: false });
      const row = container.firstElementChild;
      expect(row?.className).toContain('border-l-transparent');
      expect(row?.className).toContain('opacity-50');
    });

    it('applies custom style prop', () => {
      const { container } = renderRow({ style: { top: '100px', position: 'absolute' as const } });
      const row = container.firstElementChild as HTMLElement;
      expect(row.style.top).toBe('100px');
      expect(row.style.position).toBe('absolute');
    });
  });

  // -----------------------------------------------------------------------
  // Interactions
  // -----------------------------------------------------------------------

  describe('interactions', () => {
    it('onToggle called on checkbox click', () => {
      const onToggle = vi.fn();
      renderRow({ onToggle, index: 3 });

      fireEvent.click(screen.getByRole('checkbox'));
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(3);
    });

    it('onShiftClick called on shift+click of checkbox', () => {
      const onShiftClick = vi.fn();
      const onToggle = vi.fn();
      renderRow({ onShiftClick, onToggle, index: 5 });

      fireEvent.click(screen.getByRole('checkbox'), { shiftKey: true });
      expect(onShiftClick).toHaveBeenCalledTimes(1);
      expect(onShiftClick).toHaveBeenCalledWith(5);
      // onToggle should NOT be called
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('onForkHere called on fork button click', () => {
      const onForkHere = vi.fn();
      renderRow({ onForkHere, index: 7 });

      const forkBtn = screen.getByLabelText(/Fork at message/);
      fireEvent.click(forkBtn);
      expect(onForkHere).toHaveBeenCalledTimes(1);
      expect(onForkHere).toHaveBeenCalledWith(7);
    });

    it('fork button click does not propagate', () => {
      const onForkHere = vi.fn();
      const outerClick = vi.fn();

      render(
        // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper
        // biome-ignore lint/a11y/noStaticElementInteractions: test-only wrapper
        <div onClick={outerClick}>
          <ContextMessageRow
            message={makeMessage()}
            index={0}
            checked={true}
            onToggle={vi.fn()}
            onForkHere={onForkHere}
            onShiftClick={vi.fn()}
          />
        </div>,
      );

      const forkBtn = screen.getByLabelText(/Fork at message/);
      fireEvent.click(forkBtn);
      expect(onForkHere).toHaveBeenCalledTimes(1);
      // Outer click handler should NOT fire due to stopPropagation
      expect(outerClick).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Content display
  // -----------------------------------------------------------------------

  describe('content display', () => {
    it('truncates long content to 120 chars', () => {
      const longContent = 'A'.repeat(200);
      renderRow({ message: makeMessage({ content: longContent }) });

      const truncated = screen.getByText(/^A+\.\.\.$/);
      expect(truncated).toBeDefined();
      // 120 chars of A + "..."
      expect(truncated.textContent).toBe(`${'A'.repeat(120)}...`);
    });

    it('does not truncate short content', () => {
      renderRow({ message: makeMessage({ content: 'Short msg' }) });
      expect(screen.getByText('Short msg')).toBeDefined();
    });

    it('shows char count for thinking messages', () => {
      renderRow({
        message: makeMessage({ type: 'thinking', content: 'x'.repeat(500) }),
      });

      expect(screen.getByText('[Thinking: 500 chars]')).toBeDefined();
    });

    it('shows char count for empty thinking message', () => {
      renderRow({
        message: makeMessage({ type: 'thinking', content: '' }),
      });

      expect(screen.getByText('[Thinking: 0 chars]')).toBeDefined();
    });

    it('shows assistant label for assistant messages', () => {
      renderRow({ message: makeMessage({ type: 'assistant', content: 'Response text' }) });
      expect(screen.getByText('Claude')).toBeDefined();
      expect(screen.getByText('Response text')).toBeDefined();
    });

    it('shows tool result label', () => {
      renderRow({
        message: makeMessage({ type: 'tool_result', content: 'Result output', toolName: 'Bash' }),
      });
      expect(screen.getByText('Tool Result')).toBeDefined();
      expect(screen.getByText('Bash')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  describe('accessibility', () => {
    it('checkbox has aria-label with 1-based message number', () => {
      renderRow({ index: 4 });
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox.getAttribute('aria-label')).toBe('Select message 5');
    });

    it('fork button has aria-label with 1-based message number', () => {
      renderRow({ index: 2 });
      const forkBtn = screen.getByLabelText('Fork at message 3');
      expect(forkBtn).toBeDefined();
    });

    it('checkbox is readOnly (controlled via onClick)', () => {
      renderRow();
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.readOnly).toBe(true);
    });
  });
});
