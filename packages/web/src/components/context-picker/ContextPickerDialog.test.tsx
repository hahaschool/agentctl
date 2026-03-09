import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetMemoryTimeline, mockSearchMemory } = vi.hoisted(() => ({
  mockGetMemoryTimeline: vi.fn(),
  mockSearchMemory: vi.fn(),
}));

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

vi.mock('@/lib/model-options', () => ({
  FORK_AGENT_TYPES: [
    { value: 'adhoc', label: 'Ad-hoc', desc: 'One-shot' },
    { value: 'manual', label: 'Manual', desc: 'Persistent' },
  ],
  MODEL_OPTIONS_WITH_DEFAULT: [
    { value: '', label: 'Default' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
  AGENT_RUNTIMES: [
    { value: 'claude-code', label: 'Claude Code', desc: 'Full CLI' },
    { value: 'nanoclaw', label: 'NanoClaw', desc: 'Lightweight' },
  ],
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getMemoryTimeline: mockGetMemoryTimeline,
      searchMemory: mockSearchMemory,
    },
  };
});

// Mock the virtualizer — JSDOM has no layout so virtualizer won't render rows.
// We mock it to render all items directly.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 56,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: String(i),
      })),
  }),
}));

// ---------------------------------------------------------------------------
// Component import
// ---------------------------------------------------------------------------

import type { Session, SessionContentMessage } from '@/lib/api';
import { ContextPickerDialog } from './ContextPickerDialog';

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
    claudeSessionId: 'claude-abc123def456',
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

function makeMessage(overrides: Partial<SessionContentMessage> = {}): SessionContentMessage {
  return {
    type: 'human',
    content: 'Hello, world!',
    timestamp: '2026-03-06T14:30:00Z',
    ...overrides,
  };
}

function makeMessages(count: number): SessionContentMessage[] {
  const types: SessionContentMessage['type'][] = [
    'human',
    'assistant',
    'tool_use',
    'tool_result',
    'thinking',
  ];
  return Array.from({ length: count }, (_, i) =>
    makeMessage({
      type: types[i % types.length],
      content: `Message ${String(i)} content`,
      timestamp: `2026-03-06T14:${String(i).padStart(2, '0')}:00Z`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderOpts = {
  defaultTab?: 'fork' | 'agent';
  session?: Session;
  messages?: SessionContentMessage[];
  open?: boolean;
  onClose?: () => void;
  onForkSubmit?: (config: Record<string, unknown>) => void;
  onCreateAgentSubmit?: (config: Record<string, unknown>) => void;
  isSubmitting?: boolean;
};

function renderDialog(opts: RenderOpts = {}) {
  const session = opts.session ?? makeSession();
  const messages = opts.messages ?? makeMessages(5);
  const onClose = opts.onClose ?? vi.fn();
  const onForkSubmit = opts.onForkSubmit ?? vi.fn();
  const onCreateAgentSubmit = opts.onCreateAgentSubmit ?? vi.fn();

  const result = render(
    <ContextPickerDialog
      defaultTab={opts.defaultTab}
      session={session}
      messages={messages}
      open={opts.open ?? true}
      onClose={onClose}
      onForkSubmit={onForkSubmit as never}
      onCreateAgentSubmit={onCreateAgentSubmit as never}
      isSubmitting={opts.isSubmitting ?? false}
    />,
  );

  return { ...result, onClose, onForkSubmit, onCreateAgentSubmit, session, messages };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockGetMemoryTimeline.mockReset();
  mockSearchMemory.mockReset();
  mockGetMemoryTimeline.mockResolvedValue({ observations: [] });
  mockSearchMemory.mockResolvedValue({ observations: [] });
});

// ===========================================================================
// Tests
// ===========================================================================

describe('ContextPickerDialog', () => {
  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('renders nothing when open=false', () => {
      const { container } = renderDialog({ open: false });
      expect(container.innerHTML).toBe('');
    });

    it('shows "Fork Session" title by default', () => {
      renderDialog();
      // Title appears in h2 and also in submit buttons; use heading role
      const heading = screen.getByRole('heading', { name: 'Fork Session' });
      expect(heading).toBeDefined();
      expect(heading.tagName).toBe('H2');
    });

    it('shows "Create Agent from Session" title when defaultTab="agent"', () => {
      renderDialog({ defaultTab: 'agent' });
      const heading = screen.getByRole('heading', { name: 'Create Agent from Session' });
      expect(heading).toBeDefined();
    });

    it('shows message list with checkboxes', () => {
      renderDialog({ messages: makeMessages(3) });
      const checkboxes = screen.getAllByRole('checkbox');
      // 3 message checkboxes
      expect(checkboxes.length).toBe(3);
    });

    it('shows empty state when no messages', () => {
      renderDialog({ messages: [] });
      expect(screen.getByText('No messages in this session')).toBeDefined();
    });

    it('shows memory search input', () => {
      renderDialog();
      expect(screen.getByLabelText('Search memories')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Fork mode
  // -----------------------------------------------------------------------

  describe('fork mode', () => {
    it('shows fork prompt textarea', () => {
      renderDialog();
      expect(screen.getByLabelText('Fork prompt')).toBeDefined();
    });

    it('shows model dropdown', () => {
      renderDialog();
      expect(screen.getByLabelText('Model')).toBeDefined();
    });

    it('shows strategy as "Full Resume" when all selected', () => {
      renderDialog({ messages: makeMessages(3) });
      expect(screen.getByText('Full Resume')).toBeDefined();
    });

    it('fork here on msg index 2 changes strategy to "JSONL Truncation"', () => {
      renderDialog({ messages: makeMessages(5) });

      // Click "Fork here" on index 2 (the 3rd message)
      const forkBtns = screen.getAllByText('Fork here');
      const btn = forkBtns.at(2);
      expect(btn).toBeDefined();
      fireEvent.click(btn as HTMLElement);

      // Now only messages 0,1,2 are selected from 5 total = contiguous from start
      expect(screen.getByText('JSONL Truncation')).toBeDefined();
    });

    it('deselecting non-contiguous messages changes strategy to "Context Injection"', () => {
      renderDialog({ messages: makeMessages(5) });

      // Deselect index 1 (skip the middle) — leaves 0,2,3,4 = non-contiguous
      const checkboxes = screen.getAllByRole('checkbox');
      const cb1 = checkboxes.at(1);
      expect(cb1).toBeDefined();
      fireEvent.click(cb1 as HTMLElement); // Deselect index 1

      expect(screen.getByText('Context Injection')).toBeDefined();
    });

    it('submit calls onForkSubmit with correct config', () => {
      const onForkSubmit = vi.fn();
      renderDialog({ messages: makeMessages(3), onForkSubmit });

      // Enter a fork prompt
      const textarea = screen.getByLabelText('Fork prompt');
      fireEvent.change(textarea, { target: { value: 'Fix the bug' } });

      // Click the fork submit button — there are multiple "Fork Session" buttons
      // (ForkConfigPanel + footer). Use getAllByText and click the last one (footer).
      const forkBtns = screen.getAllByText('Fork Session');
      const lastBtn = forkBtns.at(-1);
      expect(lastBtn).toBeDefined();
      fireEvent.click(lastBtn as HTMLElement);

      expect(onForkSubmit).toHaveBeenCalledTimes(1);
      const call = onForkSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.prompt).toBe('Fix the bug');
      expect(call.strategy).toBe('resume');
    });
  });

  // -----------------------------------------------------------------------
  // Create-agent mode
  // -----------------------------------------------------------------------

  describe('create-agent mode', () => {
    it('shows agent name, type, model, system prompt fields', () => {
      renderDialog({ defaultTab: 'agent' });

      expect(screen.getByLabelText('Agent Name')).toBeDefined();
      expect(screen.getByLabelText('Agent type')).toBeDefined();
      expect(screen.getByLabelText('Agent model')).toBeDefined();
      expect(screen.getByLabelText('System prompt')).toBeDefined();
    });

    it('submit calls onCreateAgentSubmit with config', () => {
      const onCreateAgentSubmit = vi.fn();
      renderDialog({ defaultTab: 'agent', messages: makeMessages(3), onCreateAgentSubmit });

      // Change agent name
      const nameInput = screen.getByLabelText('Agent Name');
      fireEvent.change(nameInput, { target: { value: 'my-new-agent' } });

      // Click Create Agent footer button
      fireEvent.click(screen.getByText('Create Agent'));

      expect(onCreateAgentSubmit).toHaveBeenCalledTimes(1);
      const call = onCreateAgentSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.name).toBe('my-new-agent');
      expect(call.type).toBe('adhoc');
      expect(call.runtime).toBe('claude-code');
      expect(call.selectedMessageIds).toEqual([0, 1, 2]);
    });

    it('agent name defaults to "{agentName}-fork"', () => {
      renderDialog({
        defaultTab: 'agent',
        session: makeSession({ agentName: 'my-agent' }),
      });

      const nameInput = screen.getByLabelText('Agent Name') as HTMLInputElement;
      expect(nameInput.value).toBe('my-agent-fork');
    });

    it('submit disabled when name empty', () => {
      renderDialog({ defaultTab: 'agent' });

      // Clear the name
      const nameInput = screen.getByLabelText('Agent Name');
      fireEvent.change(nameInput, { target: { value: '' } });

      const submitBtn = screen.getByText('Create Agent') as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  describe('selection', () => {
    it('Fork Here on index N selects 0..N, deselects N+1..end', () => {
      const onForkSubmit = vi.fn();
      renderDialog({ messages: makeMessages(5), onForkSubmit });

      // Fork at index 2 (3rd message)
      const forkBtns = screen.getAllByText('Fork here');
      const forkBtn2 = forkBtns.at(2);
      expect(forkBtn2).toBeDefined();
      fireEvent.click(forkBtn2 as HTMLElement);

      // Verify: first 3 checkboxes checked, last 2 unchecked
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      expect(checkboxes.at(0)?.checked).toBe(true);
      expect(checkboxes.at(1)?.checked).toBe(true);
      expect(checkboxes.at(2)?.checked).toBe(true);
      expect(checkboxes.at(3)?.checked).toBe(false);
      expect(checkboxes.at(4)?.checked).toBe(false);
    });

    it('Select All selects everything', () => {
      renderDialog({ messages: makeMessages(5) });

      // First deselect all
      fireEvent.click(screen.getByText('Deselect All'));

      // Then select all
      fireEvent.click(screen.getByText('Select All'));

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      for (const cb of checkboxes) {
        expect(cb.checked).toBe(true);
      }
    });

    it('Deselect All clears everything', () => {
      renderDialog({ messages: makeMessages(5) });

      fireEvent.click(screen.getByText('Deselect All'));

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      for (const cb of checkboxes) {
        expect(cb.checked).toBe(false);
      }
    });

    it('Invert flips selection', () => {
      renderDialog({ messages: makeMessages(5) });

      // All are initially selected. Fork here at index 1 → selects 0,1, deselects 2,3,4
      const forkBtns = screen.getAllByText('Fork here');
      const forkBtn1 = forkBtns.at(1);
      expect(forkBtn1).toBeDefined();
      fireEvent.click(forkBtn1 as HTMLElement);

      // Now invert → 2,3,4 selected, 0,1 deselected
      fireEvent.click(screen.getByText('Invert'));

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      expect(checkboxes.at(0)?.checked).toBe(false);
      expect(checkboxes.at(1)?.checked).toBe(false);
      expect(checkboxes.at(2)?.checked).toBe(true);
      expect(checkboxes.at(3)?.checked).toBe(true);
      expect(checkboxes.at(4)?.checked).toBe(true);
    });

    it('individual toggle works', () => {
      renderDialog({ messages: makeMessages(3) });

      // All start checked. Click checkbox 1 to deselect
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const cb1 = checkboxes.at(1);
      expect(cb1).toBeDefined();
      fireEvent.click(cb1 as HTMLElement);
      expect(cb1?.checked).toBe(false);

      // Click again to re-select
      fireEvent.click(cb1 as HTMLElement);
      expect(cb1?.checked).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Memory integration
  // -----------------------------------------------------------------------

  describe('memory integration', () => {
    it('clicking a memory observation auto-selects matching messages', async () => {
      mockGetMemoryTimeline.mockResolvedValue({
        observations: [
          {
            id: 42,
            type: 'bugfix',
            title: 'Auth middleware fix',
            files_modified: '["packages/web/src/auth.ts"]',
            created_at: '2026-03-09T10:00:00Z',
          },
        ],
      });

      renderDialog({
        messages: [
          makeMessage({ type: 'human', content: 'Fix auth.ts middleware for login flow' }),
          makeMessage({ type: 'assistant', content: 'Updated billing service behavior' }),
        ],
      });

      await waitFor(() => {
        expect(screen.getByText('Auth middleware fix')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Deselect All'));
      expect(screen.getByText(/0 selected/)).toBeDefined();

      fireEvent.click(screen.getByText('Auth middleware fix'));

      await waitFor(() => {
        expect(screen.getByText(/1 selected/)).toBeDefined();
      });

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      expect(checkboxes[0]?.checked).toBe(true);
      expect(checkboxes[1]?.checked).toBe(false);
    });

    it('memory search uses debounced query and renders search results', async () => {
      mockSearchMemory.mockResolvedValue({
        observations: [
          {
            id: 77,
            type: 'decision',
            title: 'Use auth middleware guard',
            created_at: '2026-03-09T11:00:00Z',
          },
        ],
      });

      renderDialog({ messages: makeMessages(2) });
      fireEvent.change(screen.getByLabelText('Search memories'), {
        target: { value: 'auth' },
      });

      await waitFor(() => {
        expect(mockSearchMemory).toHaveBeenCalledWith(expect.objectContaining({ q: 'auth' }));
        expect(screen.getByText('Use auth middleware guard')).toBeDefined();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Search & Filter
  // -----------------------------------------------------------------------

  describe('search and filter', () => {
    it('search filters messages by content', () => {
      renderDialog({
        messages: [
          makeMessage({ content: 'alpha beta' }),
          makeMessage({ content: 'gamma delta' }),
          makeMessage({ content: 'alpha gamma' }),
        ],
      });

      const searchInput = screen.getByPlaceholderText('Search messages...');
      fireEvent.change(searchInput, { target: { value: 'alpha' } });

      // Only 2 messages contain "alpha"
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(2);
    });

    it('filter by type filters messages', () => {
      renderDialog({
        messages: [
          makeMessage({ type: 'human', content: 'User msg' }),
          makeMessage({ type: 'assistant', content: 'AI response' }),
          makeMessage({ type: 'human', content: 'Another user msg' }),
        ],
      });

      const filterSelect = screen.getByLabelText('Filter by type');
      fireEvent.change(filterSelect, { target: { value: 'human' } });

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(2);
    });

    it('search + filter combine (AND logic)', () => {
      renderDialog({
        messages: [
          makeMessage({ type: 'human', content: 'alpha' }),
          makeMessage({ type: 'assistant', content: 'alpha response' }),
          makeMessage({ type: 'human', content: 'beta' }),
        ],
      });

      // Filter to human only
      const filterSelect = screen.getByLabelText('Filter by type');
      fireEvent.change(filterSelect, { target: { value: 'human' } });

      // Search for "alpha"
      const searchInput = screen.getByPlaceholderText('Search messages...');
      fireEvent.change(searchInput, { target: { value: 'alpha' } });

      // Only 1 message is both human AND contains "alpha"
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Token estimation
  // -----------------------------------------------------------------------

  describe('token estimation', () => {
    it('shows estimated token count', () => {
      // Each message has "Message N content" ≈ 17-18 chars.
      // 5 messages * ~17 chars = ~85 chars / 3.5 ≈ 24 tokens
      renderDialog({ messages: makeMessages(5) });

      // The token count appears in both toolbar and summary bar.
      // Just check that a number followed by "tokens" is displayed.
      const tokenTexts = screen.getAllByText(/tokens/);
      expect(tokenTexts.length).toBeGreaterThan(0);
    });

    it('hide tool results toggle reduces token count', () => {
      const messages = [
        makeMessage({ type: 'human', content: 'A'.repeat(100) }),
        makeMessage({ type: 'tool_result', content: 'B'.repeat(500) }),
      ];
      renderDialog({ messages });

      // Get the initial token display from the summary bar
      const summaryBar = screen.getByText(/est\./);
      const initialText = summaryBar.parentElement?.textContent ?? '';

      // Click "Hide tool results" toggle
      fireEvent.click(screen.getByText('Hide tool results'));

      // Token count should decrease (tool_result excluded)
      const afterText = summaryBar.parentElement?.textContent ?? '';
      expect(afterText).not.toBe(initialText);
    });

    it('collapse thinking toggle reduces token count', () => {
      const messages = [
        makeMessage({ type: 'human', content: 'A'.repeat(100) }),
        makeMessage({ type: 'thinking', content: 'T'.repeat(1000) }),
      ];
      renderDialog({ messages });

      const summaryBar = screen.getByText(/est\./);
      const initialText = summaryBar.parentElement?.textContent ?? '';

      // Click "Collapse thinking" toggle
      fireEvent.click(screen.getByText('Collapse thinking'));

      const afterText = summaryBar.parentElement?.textContent ?? '';
      expect(afterText).not.toBe(initialText);
    });
  });

  // -----------------------------------------------------------------------
  // Close / Cancel
  // -----------------------------------------------------------------------

  describe('close and cancel', () => {
    it('cancel button calls onClose', () => {
      const onClose = vi.fn();
      renderDialog({ onClose });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('backdrop click calls onClose', () => {
      const onClose = vi.fn();
      renderDialog({ onClose });

      fireEvent.click(screen.getByLabelText('Close dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('X button calls onClose', () => {
      const onClose = vi.fn();
      renderDialog({ onClose });

      fireEvent.click(screen.getByLabelText('Close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Submitting state
  // -----------------------------------------------------------------------

  describe('submitting state', () => {
    it('shows "Forking..." in fork mode when isSubmitting', () => {
      renderDialog({ isSubmitting: true });
      // "Forking..." appears in both ForkConfigPanel and footer buttons
      const btns = screen.getAllByText('Forking...');
      expect(btns.length).toBeGreaterThanOrEqual(1);
    });

    it('shows "Creating..." in create-agent mode when isSubmitting', () => {
      renderDialog({ defaultTab: 'agent', isSubmitting: true });
      expect(screen.getByText('Creating...')).toBeDefined();
    });

    it('cancel button disabled when isSubmitting', () => {
      renderDialog({ isSubmitting: true });
      const cancelBtn = screen.getByText('Cancel') as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Strategy auto-detection (via fork panel display)
  // -----------------------------------------------------------------------

  describe('strategy auto-detection', () => {
    it('all selected → "Full Resume"', () => {
      renderDialog({ messages: makeMessages(3) });
      expect(screen.getByText('Full Resume')).toBeDefined();
    });

    it('contiguous from start → "JSONL Truncation"', () => {
      renderDialog({ messages: makeMessages(5) });

      // Fork here at index 2 → selects 0,1,2
      const forkBtns = screen.getAllByText('Fork here');
      const forkBtn2 = forkBtns.at(2);
      expect(forkBtn2).toBeDefined();
      fireEvent.click(forkBtn2 as HTMLElement);

      expect(screen.getByText('JSONL Truncation')).toBeDefined();
    });

    it('non-contiguous → "Context Injection"', () => {
      renderDialog({ messages: makeMessages(5) });

      // Deselect index 1 → leaves 0,2,3,4 = non-contiguous
      const checkboxes = screen.getAllByRole('checkbox');
      const cb1 = checkboxes.at(1);
      expect(cb1).toBeDefined();
      fireEvent.click(cb1 as HTMLElement);

      expect(screen.getByText('Context Injection')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // No-messages filter result
  // -----------------------------------------------------------------------

  describe('filtered empty state', () => {
    it('shows filter empty message when search yields no results', () => {
      renderDialog({
        messages: [makeMessage({ content: 'Hello' })],
      });

      const searchInput = screen.getByPlaceholderText('Search messages...');
      fireEvent.change(searchInput, { target: { value: 'zzz-no-match' } });

      expect(screen.getByText('No messages match the current filter')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  describe('accessibility', () => {
    it('dialog has role="dialog" and aria-label', () => {
      renderDialog();
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-label')).toBe('Fork Session');
    });

    it('create-agent dialog has correct aria-label', () => {
      renderDialog({ defaultTab: 'agent' });
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-label')).toBe('Create Agent from Session');
    });
  });

  // -----------------------------------------------------------------------
  // Tab toggle
  // -----------------------------------------------------------------------

  describe('tab toggle', () => {
    it('renders Quick Fork and Create as Agent tabs', () => {
      renderDialog();
      expect(screen.getByRole('tab', { name: /quick fork/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /create as agent/i })).toBeDefined();
    });

    it('defaults to Quick Fork tab', () => {
      renderDialog();
      const forkTab = screen.getByRole('tab', { name: /quick fork/i });
      expect(forkTab.getAttribute('aria-selected')).toBe('true');
    });

    it('switches to Create as Agent tab', () => {
      renderDialog();
      fireEvent.click(screen.getByRole('tab', { name: /create as agent/i }));
      expect(screen.getByLabelText('Agent Name')).toBeDefined();
    });

    it('defaultTab="agent" opens on Create as Agent', () => {
      renderDialog({ defaultTab: 'agent' });
      const agentTab = screen.getByRole('tab', { name: /create as agent/i });
      expect(agentTab.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByLabelText('Agent Name')).toBeDefined();
    });

    it('shows runtime selector in agent tab', () => {
      renderDialog({ defaultTab: 'agent' });
      expect(screen.getByLabelText('Agent runtime')).toBeDefined();
    });

    it('includes runtime in create-agent submit config', () => {
      const onCreateAgentSubmit = vi.fn();
      renderDialog({ defaultTab: 'agent', messages: makeMessages(3), onCreateAgentSubmit });

      const nameInput = screen.getByLabelText('Agent Name');
      fireEvent.change(nameInput, { target: { value: 'my-new-agent' } });

      // Select nanoclaw runtime
      const runtimeSelect = screen.getByLabelText('Agent runtime');
      fireEvent.change(runtimeSelect, { target: { value: 'nanoclaw' } });

      fireEvent.click(screen.getByText('Create Agent'));

      expect(onCreateAgentSubmit).toHaveBeenCalledTimes(1);
      const call = onCreateAgentSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.runtime).toBe('nanoclaw');
    });
  });
});
