import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AuditAction } from '../lib/api';
import { LogsAuditActionRow } from './LogsAuditActionRow';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../lib/format-utils', () => ({
  formatDateTime: (s: string) => `datetime:${s}`,
  formatTime: (s: string) => `time:${s}`,
  formatDurationMs: (ms: number | null | undefined) => (ms ? `${ms}ms` : '-'),
}));

vi.mock('./CopyableText', () => ({
  CopyableText: ({ value, maxDisplay }: { value: string; maxDisplay?: number }) => (
    <span data-testid="copyable-text">{value.slice(0, maxDisplay ?? 8)}</span>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<AuditAction> = {}): AuditAction {
  return {
    id: 'act-001',
    runId: 'run-001',
    timestamp: '2026-03-07T12:00:00Z',
    actionType: 'tool_use',
    toolName: 'Read',
    toolInput: null,
    toolOutputHash: null,
    durationMs: null,
    approvedBy: null,
    agentId: null,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('LogsAuditActionRow', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it('renders action type badge', () => {
    render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.getByText('tool_use')).toBeDefined();
  });

  it('renders tool name when present', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ toolName: 'Bash' })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.getByText('Bash')).toBeDefined();
  });

  it('does not render tool name when null', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ toolName: null })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.queryByText('Read')).toBeNull();
  });

  it('renders formatted timestamp', () => {
    render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.getByText('time:2026-03-07T12:00:00Z')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Action type colors
  // -----------------------------------------------------------------------

  it.each([
    ['tool_use', 'text-blue-500'],
    ['tool_result', 'text-green-500'],
    ['text', 'text-muted-foreground'],
    ['error', 'text-red-500'],
    ['unknown_type', 'text-muted-foreground'],
  ])('applies correct color class for actionType "%s"', (actionType, expectedClass) => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction({ actionType })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const badge = container.querySelector('span');
    expect(badge?.className).toContain(expectedClass);
  });

  // -----------------------------------------------------------------------
  // Border on non-first items
  // -----------------------------------------------------------------------

  it('does not apply top border when isFirst is true', () => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).not.toContain('border-t');
  });

  it('applies top border when isFirst is false', () => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={false}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).toContain('border-t');
  });

  // -----------------------------------------------------------------------
  // Toggle / onToggle callback
  // -----------------------------------------------------------------------

  it('calls onToggle when the row control is clicked', () => {
    const onToggle = vi.fn();
    render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={false}
        onToggle={onToggle}
        searchQuery=""
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Expand indicator direction
  // -----------------------------------------------------------------------

  it('shows expand indicator rotated when collapsed', () => {
    render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    // The arrow span is the last child of the row control
    const rowControl = screen.getByRole('button');
    const arrow = rowControl.lastElementChild as HTMLElement;
    expect(arrow.className).toContain('-rotate-90');
  });

  it('shows expand indicator un-rotated when expanded', () => {
    render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={true}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const rowControl = screen.getByRole('button');
    const arrow = rowControl.lastElementChild as HTMLElement;
    expect(arrow.className).toContain('rotate-0');
    expect(arrow.className).not.toContain('-rotate-90');
  });

  // -----------------------------------------------------------------------
  // Expanded details panel
  // -----------------------------------------------------------------------

  it('does not render details when collapsed', () => {
    render(
      <LogsAuditActionRow
        action={makeAction()}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.queryByText('ID:')).toBeNull();
  });

  it('renders detail rows when expanded', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({
          toolName: 'Bash',
          durationMs: 1234,
          approvedBy: 'user-1',
          toolOutputHash: 'abc123',
        })}
        isFirst={true}
        isExpanded={true}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.getByText('ID:')).toBeDefined();
    expect(screen.getByText('act-001')).toBeDefined();
    expect(screen.getByText('Run ID:')).toBeDefined();
    expect(screen.getByText('run-001')).toBeDefined();
    expect(screen.getByText('Timestamp:')).toBeDefined();
    expect(screen.getByText('datetime:2026-03-07T12:00:00Z')).toBeDefined();
    expect(screen.getByText('Action Type:')).toBeDefined();
    expect(screen.getByText('Tool:')).toBeDefined();
    expect(screen.getByText('Duration:')).toBeDefined();
    // "1234ms" appears twice: once in the collapsed row (formatDurationMs) and once in the detail panel
    expect(screen.getAllByText('1234ms').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Approved By:')).toBeDefined();
    expect(screen.getByText('user-1')).toBeDefined();
    expect(screen.getByText('Output Hash:')).toBeDefined();
    expect(screen.getByText('abc123')).toBeDefined();
  });

  it('renders tool input JSON when present', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ toolInput: { command: 'ls -la' } })}
        isFirst={true}
        isExpanded={true}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.getByText('Tool Input:')).toBeDefined();
    expect(screen.getByText(/ls -la/)).toBeDefined();
  });

  it('does not render tool input when it is an empty object', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ toolInput: {} })}
        isFirst={true}
        isExpanded={true}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.queryByText('Tool Input:')).toBeNull();
  });

  it('hides optional detail rows when values are null', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({
          toolName: null,
          durationMs: null,
          approvedBy: null,
          toolOutputHash: null,
        })}
        isFirst={true}
        isExpanded={true}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.queryByText('Tool:')).toBeNull();
    expect(screen.queryByText('Duration:')).toBeNull();
    expect(screen.queryByText('Approved By:')).toBeNull();
    expect(screen.queryByText('Output Hash:')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Agent ID (CopyableText)
  // -----------------------------------------------------------------------

  it('renders CopyableText for agentId when present', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ agentId: 'agent-12345678' })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.getByTestId('copyable-text')).toBeDefined();
    expect(screen.getByTestId('copyable-text').textContent).toBe('agent-12');
  });

  it('does not render CopyableText when agentId is null', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ agentId: null })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    expect(screen.queryByTestId('copyable-text')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Duration display
  // -----------------------------------------------------------------------

  it('renders duration in the collapsed row when > 0', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ durationMs: 3000 })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    // In the collapsed row, the duration appears as formatted text
    expect(screen.getByText('3000ms')).toBeDefined();
  });

  it('does not render duration in collapsed row when null', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ durationMs: null })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    // Only the timestamp should be present as mono text
    const rowControl = screen.getByRole('button');
    const spans = rowControl.querySelectorAll('span');
    const durationSpans = Array.from(spans).filter((s) => s.textContent?.endsWith('ms'));
    expect(durationSpans.length).toBe(0);
  });

  it('applies yellow color for slow durations (> 5000ms)', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ durationMs: 6000 })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const durationEl = screen.getByText('6000ms');
    expect(durationEl.className).toContain('text-yellow-500');
  });

  it('applies muted color for normal durations (<= 5000ms)', () => {
    render(
      <LogsAuditActionRow
        action={makeAction({ durationMs: 2000 })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const durationEl = screen.getByText('2000ms');
    expect(durationEl.className).toContain('text-muted-foreground');
  });

  // -----------------------------------------------------------------------
  // Search query highlight
  // -----------------------------------------------------------------------

  it('highlights matching text in tool name', () => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction({ toolName: 'ReadFile' })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery="File"
      />,
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeDefined();
    expect(mark?.textContent).toBe('File');
  });

  it('does not highlight when search query is empty', () => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction({ toolName: 'ReadFile' })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery=""
      />,
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeNull();
  });

  it('does not highlight when search query does not match', () => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction({ toolName: 'ReadFile' })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery="xyz"
      />,
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeNull();
  });

  it('performs case-insensitive search highlighting', () => {
    const { container } = render(
      <LogsAuditActionRow
        action={makeAction({ toolName: 'ReadFile' })}
        isFirst={true}
        isExpanded={false}
        onToggle={vi.fn()}
        searchQuery="read"
      />,
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeDefined();
    expect(mark?.textContent).toBe('Read');
  });
});
