import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/model-options', () => ({
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

import type { Session } from '@/lib/api';
import { ForkConfigPanel } from './ForkConfigPanel';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderOpts = {
  session?: Session;
  forkPrompt?: string;
  onForkPromptChange?: (prompt: string) => void;
  model?: string;
  onModelChange?: (model: string) => void;
  detectedStrategy?: 'jsonl-truncation' | 'context-injection' | 'resume';
  isSubmitting?: boolean;
  onSubmit?: () => void;
};

function renderPanel(opts: RenderOpts = {}) {
  const session = opts.session ?? makeSession();
  const onForkPromptChange = opts.onForkPromptChange ?? vi.fn();
  const onModelChange = opts.onModelChange ?? vi.fn();
  const onSubmit = opts.onSubmit ?? vi.fn();

  const result = render(
    <ForkConfigPanel
      session={session}
      forkPrompt={opts.forkPrompt ?? ''}
      onForkPromptChange={onForkPromptChange}
      model={opts.model ?? ''}
      onModelChange={onModelChange}
      detectedStrategy={opts.detectedStrategy ?? 'jsonl-truncation'}
      isSubmitting={opts.isSubmitting ?? false}
      onSubmit={onSubmit}
    />,
  );

  return { ...result, onForkPromptChange, onModelChange, onSubmit, session };
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

describe('ForkConfigPanel', () => {
  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('renders prompt textarea, model dropdown, and strategy display', () => {
      renderPanel();

      expect(screen.getByLabelText('Fork prompt')).toBeDefined();
      expect(screen.getByLabelText('Model')).toBeDefined();
      expect(screen.getByText('Strategy')).toBeDefined();
    });

    it('shows model dropdown with options', () => {
      renderPanel();
      const select = screen.getByLabelText('Model') as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(options).toContain('Default');
      expect(options).toContain('Claude Sonnet 4.6');
      expect(options).toContain('Claude Opus 4.6');
    });

    it('shows fork prompt value', () => {
      renderPanel({ forkPrompt: 'Fix the bug' });
      const textarea = screen.getByLabelText('Fork prompt') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Fix the bug');
    });

    it('shows selected model value', () => {
      renderPanel({ model: 'claude-opus-4-6' });
      const select = screen.getByLabelText('Model') as HTMLSelectElement;
      expect(select.value).toBe('claude-opus-4-6');
    });
  });

  // -----------------------------------------------------------------------
  // Strategy display
  // -----------------------------------------------------------------------

  describe('strategy display', () => {
    it('shows "JSONL Truncation" with green badge for jsonl-truncation', () => {
      const { container } = renderPanel({ detectedStrategy: 'jsonl-truncation' });
      expect(screen.getByText('JSONL Truncation')).toBeDefined();
      expect(screen.getByText('Perfect fidelity')).toBeDefined();
      const badge = container.querySelector('.bg-green-500\\/20');
      expect(badge).not.toBeNull();
    });

    it('shows "Context Injection" with yellow badge for context-injection', () => {
      const { container } = renderPanel({ detectedStrategy: 'context-injection' });
      expect(screen.getByText('Context Injection')).toBeDefined();
      expect(screen.getByText('Cherry-picked messages')).toBeDefined();
      const badge = container.querySelector('.bg-yellow-500\\/20');
      expect(badge).not.toBeNull();
    });

    it('shows "Full Resume" with blue badge for resume', () => {
      const { container } = renderPanel({ detectedStrategy: 'resume' });
      expect(screen.getByText('Full Resume')).toBeDefined();
      expect(screen.getByText('All messages')).toBeDefined();
      const badge = container.querySelector('.bg-blue-500\\/20');
      expect(badge).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Source session info
  // -----------------------------------------------------------------------

  describe('source session info', () => {
    it('shows source session ID truncated', () => {
      renderPanel();
      expect(screen.getByText('Source Session')).toBeDefined();
      // First 16 chars of "sess-1234567890abcdef1234567890abcdef" = "sess-1234567890a"
      expect(screen.getByText('sess-1234567890a...')).toBeDefined();
    });

    it('shows agent name when present', () => {
      renderPanel({ session: makeSession({ agentName: 'my-agent' }) });
      expect(screen.getByText('Agent: my-agent')).toBeDefined();
    });

    it('omits agent name when null', () => {
      renderPanel({ session: makeSession({ agentName: null }) });
      expect(screen.queryByText(/Agent:/)).toBeNull();
    });

    it('shows claude session ID when present', () => {
      renderPanel({ session: makeSession({ claudeSessionId: 'claude-abc123def456' }) });
      // First 12 chars: "claude-abc12"
      expect(screen.getByText('Claude: claude-abc12...')).toBeDefined();
    });

    it('omits claude session ID when null', () => {
      renderPanel({ session: makeSession({ claudeSessionId: null }) });
      expect(screen.queryByText(/Claude:/)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Submit behavior
  // -----------------------------------------------------------------------

  describe('submit', () => {
    it('submit button disabled when prompt is empty', () => {
      renderPanel({ forkPrompt: '' });
      const btn = screen.getByText('Fork Session') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('submit button disabled when prompt is whitespace only', () => {
      renderPanel({ forkPrompt: '   ' });
      const btn = screen.getByText('Fork Session') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('submit button enabled when prompt has content', () => {
      renderPanel({ forkPrompt: 'Do something' });
      const btn = screen.getByText('Fork Session') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('clicking submit calls onSubmit', () => {
      const onSubmit = vi.fn();
      renderPanel({ forkPrompt: 'Fix it', onSubmit });

      fireEvent.click(screen.getByText('Fork Session'));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('does not call onSubmit when button is disabled', () => {
      const onSubmit = vi.fn();
      renderPanel({ forkPrompt: '', onSubmit });

      const btn = screen.getByText('Fork Session') as HTMLButtonElement;
      fireEvent.click(btn);
      // Button is disabled, so click handler shouldn't fire
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('shows "Forking..." when isSubmitting=true', () => {
      renderPanel({ forkPrompt: 'Fix it', isSubmitting: true });
      expect(screen.getByText('Forking...')).toBeDefined();
      expect(screen.queryByText('Fork Session')).toBeNull();
    });

    it('submit button disabled when isSubmitting=true', () => {
      renderPanel({ forkPrompt: 'Fix it', isSubmitting: true });
      const btn = screen.getByText('Forking...') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Interactions
  // -----------------------------------------------------------------------

  describe('interactions', () => {
    it('changing prompt calls onForkPromptChange', () => {
      const onForkPromptChange = vi.fn();
      renderPanel({ onForkPromptChange });

      const textarea = screen.getByLabelText('Fork prompt');
      fireEvent.change(textarea, { target: { value: 'New prompt' } });
      expect(onForkPromptChange).toHaveBeenCalledTimes(1);
      expect(onForkPromptChange).toHaveBeenCalledWith('New prompt');
    });

    it('changing model calls onModelChange', () => {
      const onModelChange = vi.fn();
      renderPanel({ onModelChange });

      const select = screen.getByLabelText('Model');
      fireEvent.change(select, { target: { value: 'claude-opus-4-6' } });
      expect(onModelChange).toHaveBeenCalledTimes(1);
      expect(onModelChange).toHaveBeenCalledWith('claude-opus-4-6');
    });
  });

  // -----------------------------------------------------------------------
  // Textarea attributes
  // -----------------------------------------------------------------------

  describe('textarea attributes', () => {
    it('prompt textarea has 6 rows', () => {
      renderPanel();
      const textarea = screen.getByLabelText('Fork prompt') as HTMLTextAreaElement;
      expect(Number(textarea.rows)).toBe(6);
    });

    it('prompt textarea has placeholder', () => {
      renderPanel();
      const textarea = screen.getByLabelText('Fork prompt') as HTMLTextAreaElement;
      expect(textarea.placeholder).toBe('What should the forked session do...');
    });
  });
});
