import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      thinking: { label: 'Thinking', textClass: 'text-purple-400', bubbleClass: '' },
    };
    return styles[type] ?? { label: type, textClass: 'text-muted-foreground', bubbleClass: '' };
  },
}));

// ---------------------------------------------------------------------------
// Component import
// ---------------------------------------------------------------------------

import type { Session, SessionContentMessage } from '@/lib/api';
import { ForkContextPicker } from './ForkContextPicker';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1234567890abcdef1234567890abcdef',
    agentId: 'agent-1',
    agentName: 'test-agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'running',
    projectPath: '/tmp/project',
    pid: 1234,
    startedAt: '2026-03-06T00:00:00Z',
    lastHeartbeat: null,
    endedAt: null,
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function makeMessages(count = 3): SessionContentMessage[] {
  const types = ['human', 'assistant', 'tool_use', 'thinking'];
  return Array.from({ length: count }, (_, i) => ({
    type: types[i % types.length]!,
    content: `Message content ${i + 1}`,
    timestamp: `2026-03-06T00:0${i}:00Z`,
    toolName: types[i % types.length] === 'tool_use' ? 'Read' : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderOptions = {
  session?: Session;
  messages?: SessionContentMessage[];
  open?: boolean;
  onClose?: () => void;
  onSubmit?: (config: {
    name: string;
    type: string;
    model?: string;
    systemPrompt?: string;
    selectedMessageIds: number[];
  }) => void;
  isSubmitting?: boolean;
};

function renderPicker(opts: RenderOptions = {}) {
  const session = opts.session ?? makeSession();
  const messages = opts.messages ?? makeMessages();
  const onClose = opts.onClose ?? vi.fn();
  const onSubmit = opts.onSubmit ?? vi.fn();
  const open = opts.open ?? true;
  const isSubmitting = opts.isSubmitting ?? false;

  const result = render(
    <ForkContextPicker
      session={session}
      messages={messages}
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    />,
  );

  return { ...result, onClose, onSubmit, session, messages };
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

describe('ForkContextPicker', () => {
  // -----------------------------------------------------------------------
  // Visibility
  // -----------------------------------------------------------------------

  it('renders nothing when open=false', () => {
    const { container } = renderPicker({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog with title when open=true', () => {
    renderPicker({ open: true });
    expect(screen.getByText('Create Agent from Session')).toBeDefined();
    expect(screen.getByText(/Select messages to include as context/)).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Message list
  // -----------------------------------------------------------------------

  it('shows message list with content', () => {
    renderPicker();
    expect(screen.getByText(/Message content 1/)).toBeDefined();
    expect(screen.getByText(/Message content 2/)).toBeDefined();
    expect(screen.getByText(/Message content 3/)).toBeDefined();
  });

  it('shows empty state when no messages', () => {
    renderPicker({ messages: [] });
    expect(screen.getByText('No messages in this session')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Message count display
  // -----------------------------------------------------------------------

  it('shows total message count', () => {
    const msgs = makeMessages(5);
    renderPicker({ messages: msgs });
    expect(screen.getByText('5 messages')).toBeDefined();
  });

  it('shows selected message count in footer', () => {
    renderPicker();
    // All 3 messages selected by default
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText(/messages? selected/)).toBeDefined();
  });

  it('shows singular "message" when only 1 selected', () => {
    const msgs = makeMessages(1);
    renderPicker({ messages: msgs });
    expect(screen.getByText(/message selected/)).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Message type indicators
  // -----------------------------------------------------------------------

  it('shows message type labels', () => {
    renderPicker();
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('Claude')).toBeDefined();
    expect(screen.getByText('Tool Call')).toBeDefined();
  });

  it('shows tool name when present', () => {
    renderPicker();
    expect(screen.getByText('Read')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Checkbox selection
  // -----------------------------------------------------------------------

  it('all messages are checked by default', () => {
    renderPicker();
    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(true);
    }
  });

  it('toggles individual message checkbox', () => {
    renderPicker();
    const checkboxes = screen.getAllByRole('checkbox');
    const firstCheckbox = checkboxes[0]! as HTMLInputElement;

    expect(firstCheckbox.checked).toBe(true);
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox.checked).toBe(false);

    // Footer count should update to 2
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText(/messages selected/)).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Select All / Deselect All
  // -----------------------------------------------------------------------

  it('Deselect All unchecks all messages', () => {
    renderPicker();
    fireEvent.click(screen.getByText('Deselect All'));

    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(false);
    }
    // Footer should show 0 messages selected
    const footerText = screen.getByText(/messages selected/).parentElement!.textContent!;
    expect(footerText).toContain('0 messages selected');
  });

  it('Select All re-checks all messages after deselect', () => {
    renderPicker();

    // Deselect all first
    fireEvent.click(screen.getByText('Deselect All'));
    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(false);
    }

    // Now select all
    fireEvent.click(screen.getByText('Select All'));
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Create Agent button (fork/submit)
  // -----------------------------------------------------------------------

  it('Create Agent button calls onSubmit with selected message ids', () => {
    const onSubmit = vi.fn();
    renderPicker({ onSubmit });

    fireEvent.click(screen.getByText('Create Agent'));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const call = onSubmit.mock.calls[0]![0]!;
    expect(call.name).toBe('test-agent-fork');
    expect(call.type).toBe('adhoc');
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.selectedMessageIds).toEqual([0, 1, 2]);
  });

  it('Create Agent sends only checked message ids after toggle', () => {
    const onSubmit = vi.fn();
    renderPicker({ onSubmit });

    // Uncheck the first message
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);

    fireEvent.click(screen.getByText('Create Agent'));
    const call = onSubmit.mock.calls[0]![0]!;
    expect(call.selectedMessageIds).toEqual([1, 2]);
  });

  it('Create Agent is disabled when no messages selected', () => {
    renderPicker();
    fireEvent.click(screen.getByText('Deselect All'));

    const btn = screen.getByText('Create Agent');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Create Agent is disabled when name is empty', () => {
    renderPicker();
    const nameInput = screen.getByLabelText('Agent Name');
    fireEvent.change(nameInput, { target: { value: '' } });

    const btn = screen.getByText('Create Agent');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not call onSubmit when name is blank', () => {
    const onSubmit = vi.fn();
    renderPicker({ onSubmit });

    const nameInput = screen.getByLabelText('Agent Name');
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Create Agent'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows "Creating..." text when isSubmitting is true', () => {
    renderPicker({ isSubmitting: true });
    expect(screen.getByText('Creating...')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Cancel / close behavior
  // -----------------------------------------------------------------------

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Close icon button calls onClose', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Clicking backdrop calls onClose', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Character count display
  // -----------------------------------------------------------------------

  it('shows character count for selected messages', () => {
    renderPicker();
    // 3 messages: "Message content 1" (17), "Message content 2" (17), "Message content 3" (17) = 51
    expect(screen.getByText('51')).toBeDefined();
    expect(screen.getByText(/chars/)).toBeDefined();
  });

  it('formats character count with k suffix for large values', () => {
    const msgs: SessionContentMessage[] = [{ type: 'human', content: 'x'.repeat(1500) }];
    renderPicker({ messages: msgs });
    expect(screen.getByText('~1.5k')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Source session info
  // -----------------------------------------------------------------------

  it('shows source session id (truncated)', () => {
    renderPicker();
    expect(screen.getByText('sess-1234567890a...')).toBeDefined();
  });

  it('shows source agent name', () => {
    renderPicker();
    expect(screen.getByText('Agent: test-agent')).toBeDefined();
  });

  it('omits agent name when session has no agentName', () => {
    renderPicker({ session: makeSession({ agentName: null }) });
    expect(screen.queryByText(/Agent:/)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Default form values
  // -----------------------------------------------------------------------

  it('defaults agent name to "{agentName}-fork"', () => {
    renderPicker();
    const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement;
    expect(nameInput.value).toBe('test-agent-fork');
  });

  it('defaults agent name to "agent-fork" when agentName is null', () => {
    renderPicker({ session: makeSession({ agentName: null }) });
    const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement;
    expect(nameInput.value).toBe('agent-fork');
  });

  it('passes model as undefined when default is selected', () => {
    const onSubmit = vi.fn();
    renderPicker({ onSubmit, session: makeSession({ model: null }) });

    fireEvent.click(screen.getByText('Create Agent'));
    const call = onSubmit.mock.calls[0]![0]!;
    expect(call.model).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Long message truncation
  // -----------------------------------------------------------------------

  it('truncates long messages in the list', () => {
    const longContent = 'A'.repeat(200);
    const msgs: SessionContentMessage[] = [{ type: 'human', content: longContent }];
    renderPicker({ messages: msgs });
    // Should be truncated to 120 chars + "..."
    const truncated = screen.getByText(/^A+\.\.\.$/);
    expect(truncated).toBeDefined();
  });
});
