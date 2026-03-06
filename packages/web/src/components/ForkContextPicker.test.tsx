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
      thinking: { label: 'Thinking', textClass: 'text-purple-400', bubbleClass: '' },
    };
    return styles[type] ?? { label: type, textClass: 'text-muted-foreground', bubbleClass: '' };
  },
}));

vi.mock('@/lib/model-options', () => ({
  FORK_AGENT_TYPES: [
    { value: 'adhoc', label: 'Ad-hoc', desc: 'One-shot task, runs once then stops' },
    { value: 'manual', label: 'Manual', desc: 'Started/stopped manually, persistent config' },
    { value: 'loop', label: 'Loop', desc: 'Runs in a loop until stopped or goal met' },
  ],
  MODEL_OPTIONS_WITH_DEFAULT: [
    { value: '', label: 'Default' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
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
    type: types[i % types.length] ?? 'human',
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
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('renders nothing when open=false', () => {
      const { container } = renderPicker({ open: false });
      expect(container.innerHTML).toBe('');
    });

    it('renders dialog when open=true', () => {
      renderPicker({ open: true });
      expect(screen.getByText('Create Agent from Session')).toBeDefined();
    });

    it('shows "Create Agent from Session" title', () => {
      renderPicker();
      expect(screen.getByText('Create Agent from Session')).toBeDefined();
      expect(screen.getByText(/Select messages to include as context/)).toBeDefined();
    });

    it('shows agent name input pre-filled with "{agentName}-fork"', () => {
      renderPicker();
      const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement;
      expect(nameInput.value).toBe('test-agent-fork');
    });

    it('shows agent type dropdown with adhoc/manual/loop options', () => {
      renderPicker();
      const typeSelect = screen.getByLabelText('Agent Type') as HTMLSelectElement;
      expect(typeSelect).toBeDefined();

      const options = typeSelect.querySelectorAll('option');
      const values = Array.from(options).map((o) => o.value);
      expect(values).toContain('adhoc');
      expect(values).toContain('manual');
      expect(values).toContain('loop');
    });

    it('shows model dropdown', () => {
      renderPicker();
      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement;
      expect(modelSelect).toBeDefined();

      const options = modelSelect.querySelectorAll('option');
      const labels = Array.from(options).map((o) => o.textContent);
      expect(labels).toContain('Default');
      expect(labels).toContain('Claude Sonnet 4.6');
    });

    it('shows system prompt textarea', () => {
      renderPicker();
      const textarea = screen.getByLabelText('System Prompt (optional)') as HTMLTextAreaElement;
      expect(textarea).toBeDefined();
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('shows message list with checkboxes', () => {
      renderPicker();
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(3);
    });

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

    it('shows source session info', () => {
      renderPicker();
      expect(screen.getByText('Source Session')).toBeDefined();
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

    it('shows total message count', () => {
      const msgs = makeMessages(5);
      renderPicker({ messages: msgs });
      expect(screen.getByText('5 messages')).toBeDefined();
    });

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

    it('defaults agent name to "agent-fork" when agentName is null', () => {
      renderPicker({ session: makeSession({ agentName: null }) });
      const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement;
      expect(nameInput.value).toBe('agent-fork');
    });
  });

  // -----------------------------------------------------------------------
  // Message selection
  // -----------------------------------------------------------------------

  describe('message selection', () => {
    it('all messages are checked by default', () => {
      renderPicker();
      const checkboxes = screen.getAllByRole('checkbox');
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).toBe(true);
      }
    });

    it('clicking a checkbox toggles selection', () => {
      renderPicker();
      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0] as HTMLInputElement;

      expect(firstCheckbox.checked).toBe(true);
      fireEvent.click(firstCheckbox);
      expect(firstCheckbox.checked).toBe(false);

      // Toggle back on
      fireEvent.click(firstCheckbox);
      expect(firstCheckbox.checked).toBe(true);
    });

    it('"Select All" button selects all messages', () => {
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

    it('"Deselect All" button deselects all messages', () => {
      renderPicker();
      fireEvent.click(screen.getByText('Deselect All'));

      const checkboxes = screen.getAllByRole('checkbox');
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).toBe(false);
      }
    });

    it('footer shows selected count and character count', () => {
      renderPicker();
      // All 3 messages selected by default
      expect(screen.getByText('3')).toBeDefined();
      expect(screen.getByText(/messages selected/)).toBeDefined();
      // "Message content 1" (17) + "Message content 2" (17) + "Message content 3" (17) = 51
      expect(screen.getByText('51')).toBeDefined();
      expect(screen.getByText(/chars/)).toBeDefined();
    });

    it('footer updates selected count after toggling checkbox', () => {
      renderPicker();
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0] as HTMLInputElement);

      // Should now show 2 messages selected
      expect(screen.getByText('2')).toBeDefined();
      expect(screen.getByText(/messages selected/)).toBeDefined();
    });

    it('character count formats as ~X.Xk for 1000+ chars', () => {
      const msgs: SessionContentMessage[] = [{ type: 'human', content: 'x'.repeat(1500) }];
      renderPicker({ messages: msgs });
      expect(screen.getByText('~1.5k')).toBeDefined();
    });

    it('shows singular "message" when only 1 selected', () => {
      const msgs = makeMessages(1);
      renderPicker({ messages: msgs });
      expect(screen.getByText(/message selected/)).toBeDefined();
      // Confirm it is singular (not "messages")
      const footerText = screen.getByText(/selected/).closest('div')?.textContent ?? '';
      expect(footerText).toMatch(/1\s*message selected/);
    });

    it('deselect all then footer shows 0 messages selected', () => {
      renderPicker();
      fireEvent.click(screen.getByText('Deselect All'));

      const footerText = screen.getByText(/messages selected/).parentElement?.textContent ?? '';
      expect(footerText).toContain('0 messages selected');
    });
  });

  // -----------------------------------------------------------------------
  // Form interaction
  // -----------------------------------------------------------------------

  describe('form interaction', () => {
    it('changing agent name updates input', () => {
      renderPicker();
      const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'my-new-agent' } });
      expect(nameInput.value).toBe('my-new-agent');
    });

    it('changing agent type updates dropdown', () => {
      renderPicker();
      const typeSelect = screen.getByLabelText('Agent Type') as HTMLSelectElement;
      expect(typeSelect.value).toBe('adhoc');

      fireEvent.change(typeSelect, { target: { value: 'loop' } });
      expect(typeSelect.value).toBe('loop');
    });

    it('changing model updates dropdown', () => {
      renderPicker({ session: makeSession({ model: null }) });
      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement;
      expect(modelSelect.value).toBe('');

      fireEvent.change(modelSelect, { target: { value: 'claude-opus-4-6' } });
      expect(modelSelect.value).toBe('claude-opus-4-6');
    });

    it('changing system prompt updates textarea', () => {
      renderPicker();
      const textarea = screen.getByLabelText('System Prompt (optional)') as HTMLTextAreaElement;
      expect(textarea.value).toBe('');

      fireEvent.change(textarea, { target: { value: 'Be concise.' } });
      expect(textarea.value).toBe('Be concise.');
    });
  });

  // -----------------------------------------------------------------------
  // Submission
  // -----------------------------------------------------------------------

  describe('submission', () => {
    it('"Create Agent" button calls onSubmit with form data', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit });

      fireEvent.click(screen.getByText('Create Agent'));
      expect(onSubmit).toHaveBeenCalledTimes(1);

      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.name).toBe('test-agent-fork');
      expect(call.type).toBe('adhoc');
      expect(call.model).toBe('claude-sonnet-4-6');
      expect(call.selectedMessageIds).toEqual([0, 1, 2]);
    });

    it('onSubmit receives selectedMessageIds sorted', () => {
      const onSubmit = vi.fn();
      const msgs = makeMessages(5);
      renderPicker({ onSubmit, messages: msgs });

      // Deselect indices 0 and 2, leave 1, 3, 4
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0] as HTMLInputElement);
      fireEvent.click(checkboxes[2] as HTMLInputElement);

      fireEvent.click(screen.getByText('Create Agent'));
      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.selectedMessageIds).toEqual([1, 3, 4]);
    });

    it('onSubmit receives name, type, model, systemPrompt', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit });

      // Modify all form fields
      fireEvent.change(screen.getByLabelText('Agent Name'), {
        target: { value: 'custom-agent' },
      });
      fireEvent.change(screen.getByLabelText('Agent Type'), {
        target: { value: 'manual' },
      });
      fireEvent.change(screen.getByLabelText('Model'), {
        target: { value: 'claude-opus-4-6' },
      });
      fireEvent.change(screen.getByLabelText('System Prompt (optional)'), {
        target: { value: 'You are helpful.' },
      });

      fireEvent.click(screen.getByText('Create Agent'));
      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.name).toBe('custom-agent');
      expect(call.type).toBe('manual');
      expect(call.model).toBe('claude-opus-4-6');
      expect(call.systemPrompt).toBe('You are helpful.');
    });

    it('empty model is submitted as undefined', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit, session: makeSession({ model: null }) });

      fireEvent.click(screen.getByText('Create Agent'));
      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.model).toBeUndefined();
    });

    it('empty system prompt is submitted as undefined', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit });

      fireEvent.click(screen.getByText('Create Agent'));
      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.systemPrompt).toBeUndefined();
    });

    it('whitespace-only system prompt is submitted as undefined', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit });

      fireEvent.change(screen.getByLabelText('System Prompt (optional)'), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByText('Create Agent'));
      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.systemPrompt).toBeUndefined();
    });

    it('button is disabled when name is empty', () => {
      renderPicker();
      const nameInput = screen.getByLabelText('Agent Name');
      fireEvent.change(nameInput, { target: { value: '' } });

      const btn = screen.getByText('Create Agent') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('button is disabled when no messages selected', () => {
      renderPicker();
      fireEvent.click(screen.getByText('Deselect All'));

      const btn = screen.getByText('Create Agent') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('does not call onSubmit when name is blank whitespace', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit });

      fireEvent.change(screen.getByLabelText('Agent Name'), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByText('Create Agent'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('button shows "Creating..." when isSubmitting=true', () => {
      renderPicker({ isSubmitting: true });
      expect(screen.getByText('Creating...')).toBeDefined();
      expect(screen.queryByText('Create Agent')).toBeNull();
    });

    it('submit button is disabled when isSubmitting=true', () => {
      renderPicker({ isSubmitting: true });
      const btn = screen.getByText('Creating...') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('cancel button is disabled when isSubmitting', () => {
      renderPicker({ isSubmitting: true });
      const cancelBtn = screen.getByText('Cancel') as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);
    });

    it('trims name before submitting', () => {
      const onSubmit = vi.fn();
      renderPicker({ onSubmit });

      fireEvent.change(screen.getByLabelText('Agent Name'), {
        target: { value: '  padded-name  ' },
      });
      fireEvent.click(screen.getByText('Create Agent'));
      const call = onSubmit.mock.calls[0]?.[0];
      expect(call.name).toBe('padded-name');
    });
  });

  // -----------------------------------------------------------------------
  // Closing
  // -----------------------------------------------------------------------

  describe('closing', () => {
    it('clicking backdrop calls onClose', () => {
      const onClose = vi.fn();
      renderPicker({ onClose });

      fireEvent.click(screen.getByLabelText('Close dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking X button calls onClose', () => {
      const onClose = vi.fn();
      renderPicker({ onClose });

      fireEvent.click(screen.getByLabelText('Close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('cancel button calls onClose', () => {
      const onClose = vi.fn();
      renderPicker({ onClose });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Long message truncation
  // -----------------------------------------------------------------------

  describe('message truncation', () => {
    it('truncates long messages in the list', () => {
      const longContent = 'A'.repeat(200);
      const msgs: SessionContentMessage[] = [{ type: 'human', content: longContent }];
      renderPicker({ messages: msgs });
      // Should be truncated to 120 chars + "..."
      const truncated = screen.getByText(/^A+\.\.\.$/);
      expect(truncated).toBeDefined();
    });

    it('does not truncate short messages', () => {
      const msgs: SessionContentMessage[] = [{ type: 'human', content: 'Short message' }];
      renderPicker({ messages: msgs });
      expect(screen.getByText('Short message')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Character count edge cases
  // -----------------------------------------------------------------------

  describe('character count', () => {
    it('shows exact count below 1000', () => {
      // 3 default messages: "Message content 1" (17) * 3 = 51
      renderPicker();
      expect(screen.getByText('51')).toBeDefined();
    });

    it('shows ~X.Xk for exactly 1000 chars', () => {
      const msgs: SessionContentMessage[] = [{ type: 'human', content: 'x'.repeat(1000) }];
      renderPicker({ messages: msgs });
      expect(screen.getByText('~1.0k')).toBeDefined();
    });

    it('shows 0 chars when no messages selected', () => {
      renderPicker();
      fireEvent.click(screen.getByText('Deselect All'));
      // The footer contains both "0 messages selected" and "0 chars"
      const footer = screen.getByText(/chars/).closest('div');
      expect(footer?.textContent).toContain('0');
      expect(footer?.textContent).toContain('chars');
    });

    it('updates char count when toggling messages', () => {
      renderPicker();
      // All selected: 51 chars
      expect(screen.getByText('51')).toBeDefined();

      // Deselect first message (17 chars)
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0] as HTMLInputElement);
      // Now 34 chars
      expect(screen.getByText('34')).toBeDefined();
    });
  });
});
