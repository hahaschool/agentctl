import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiAccount, Session } from '../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/format-utils', () => ({
  formatDateTime: (d: string) => `formatted:${d}`,
  formatDuration: (start: string, end: string | null) => (end ? `dur:${start}-${end}` : 'ongoing'),
}));

vi.mock('../lib/model-options', () => ({
  MODEL_OPTIONS_WITH_DEFAULT: [
    { value: '', label: 'Default' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
}));

vi.mock('./StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock('./CopyableText', () => ({
  CopyableText: ({ value }: { value: string }) => <span data-testid="copyable-text">{value}</span>,
}));

vi.mock('./DetailRow', () => ({
  DetailRow: ({ label, value }: { label: string; value: string }) => (
    <div data-testid={`detail-row-${label}`}>{value}</div>
  ),
}));

vi.mock('./GitStatusBadge', () => ({
  GitStatusBadge: ({ machineId, projectPath }: { machineId: string; projectPath: string }) => (
    <div data-testid="git-status-badge">
      {machineId}:{projectPath}
    </div>
  ),
}));

vi.mock('./ConfirmButton', () => ({
  ConfirmButton: ({
    label,
    onConfirm,
    className,
  }: {
    label: string;
    confirmLabel?: string;
    onConfirm: () => void;
    className?: string;
    confirmClassName?: string;
  }) => (
    <button type="button" data-testid="confirm-button" onClick={onConfirm} className={className}>
      {label}
    </button>
  ),
}));

vi.mock('./ConvertToAgentForm', () => ({
  ConvertToAgentForm: ({
    convertName,
    onSubmit,
    onCancel,
  }: {
    convertName: string;
    onSubmit: () => void;
    onCancel: () => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="convert-to-agent-form">
      <span data-testid="convert-name">{convertName}</span>
      <button type="button" data-testid="convert-submit" onClick={onSubmit}>
        Create Agent
      </button>
      <button type="button" data-testid="convert-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock('./SessionContent', () => ({
  SessionContent: ({
    sessionId,
    rcSessionId,
    machineId,
  }: {
    sessionId: string;
    rcSessionId: string;
    machineId: string;
    projectPath?: string;
    isActive: boolean;
    lastSentMessage: { text: string; ts: number } | null;
  }) => (
    <div data-testid="session-content">
      {sessionId}|{rcSessionId}|{machineId}
    </div>
  ),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------
import { SessionDetailPanel } from './SessionDetailPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-abc123def456',
    agentId: 'agent-001',
    agentName: 'my-test-agent',
    machineId: 'mac-mini-1',
    sessionUrl: null,
    claudeSessionId: 'claude-ses-xyz',
    status: 'active',
    projectPath: '/home/user/project',
    pid: 12345,
    startedAt: '2026-03-07T10:00:00Z',
    lastHeartbeat: '2026-03-07T10:05:00Z',
    endedAt: null,
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ApiAccount> = {}): ApiAccount {
  return {
    id: 'acct-1',
    name: 'Main Account',
    provider: 'anthropic',
    credentialMasked: '****abcd',
    priority: 1,
    rateLimit: {},
    isActive: true,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ApiAccount;
}

type SessionDetailPanelProps = Parameters<typeof SessionDetailPanel>[0];

function defaultProps(overrides: Partial<SessionDetailPanelProps> = {}): SessionDetailPanelProps {
  return {
    session: makeSession(),
    accounts: [],
    prompt: '',
    onPromptChange: vi.fn(),
    resumeModel: '',
    onResumeModelChange: vi.fn(),
    sending: false,
    lastSentMessage: null,
    showConvertDialog: false,
    convertName: 'my-test-agent',
    onConvertNameChange: vi.fn(),
    convertType: 'adhoc',
    onConvertTypeChange: vi.fn(),
    createAgentPending: false,
    forkPickerLoading: false,
    stopping: false,
    onBack: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onConvertToAgent: vi.fn(),
    onOpenConvertDialog: vi.fn(),
    onCloseConvertDialog: vi.fn(),
    onOpenForkPicker: vi.fn(),
    ...overrides,
  };
}

// ===========================================================================
// SessionDetailPanel
// ===========================================================================
describe('SessionDetailPanel', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------
  describe('header', () => {
    it('renders the session ID via CopyableText', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const copyable = screen.getByTestId('copyable-text');
      expect(copyable.textContent).toBe('ses-abc123def456');
    });

    it('renders StatusBadge with the session status', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const badge = screen.getByTestId('status-badge');
      expect(badge.textContent).toBe('active');
    });

    it('renders agent name when present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.getAllByText('my-test-agent').length).toBeGreaterThanOrEqual(1);
    });

    it('renders truncated agentId when agentName is null', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ agentName: null }) })} />,
      );
      expect(screen.getAllByText('agent-00').length).toBeGreaterThanOrEqual(1);
    });

    it('renders machineId in header metadata', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.getAllByText('mac-mini-1').length).toBeGreaterThanOrEqual(1);
    });

    it('renders model name in header metadata', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.getAllByText('claude-sonnet-4-6').length).toBeGreaterThanOrEqual(1);
    });

    it('renders "default" when model is null', () => {
      render(<SessionDetailPanel {...defaultProps({ session: makeSession({ model: null }) })} />);
      expect(screen.getByText('default')).toBeDefined();
    });

    it('renders "Open Full View" link pointing to session detail', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const links = screen.getAllByTestId('link-/sessions/ses-abc123def456');
      const fullViewLink = links.find((l) => l.textContent?.includes('Open Full View'));
      expect(fullViewLink).toBeDefined();
    });

    it('renders "Fork" link when claudeSessionId is present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.getByText('Fork')).toBeDefined();
    });

    it('does not render "Fork" link when claudeSessionId is null', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({ session: makeSession({ claudeSessionId: null }) })}
        />,
      );
      expect(screen.queryByText('Fork')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Back button
  // -------------------------------------------------------------------------
  describe('back button', () => {
    it('renders mobile back button with correct aria-label', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const backBtn = screen.getByLabelText('Back to session list');
      expect(backBtn).toBeDefined();
    });

    it('calls onBack when back button is clicked', () => {
      const onBack = vi.fn();
      render(<SessionDetailPanel {...defaultProps({ onBack })} />);
      fireEvent.click(screen.getByLabelText('Back to session list'));
      expect(onBack).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Session metadata
  // -------------------------------------------------------------------------
  describe('metadata', () => {
    it('renders session ID in detail rows', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-ID');
      expect(row.textContent).toBe('ses-abc123def456');
    });

    it('renders status detail row', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Status');
      expect(row.textContent).toBe('active');
    });

    it('renders agent detail row with agentName', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Agent');
      expect(row.textContent).toBe('my-test-agent');
    });

    it('renders agent detail row with truncated agentId when agentName is null', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ agentName: null }) })} />,
      );
      const row = screen.getByTestId('detail-row-Agent');
      expect(row.textContent).toBe('agent-00');
    });

    it('renders machine detail row', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Machine');
      expect(row.textContent).toBe('mac-mini-1');
    });

    it('renders project path when present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Project');
      expect(row.textContent).toBe('/home/user/project');
    });

    it('renders "-" for project path when null', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ projectPath: null }) })} />,
      );
      const row = screen.getByTestId('detail-row-Project');
      expect(row.textContent).toBe('-');
    });

    it('renders Claude Session ID when present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Claude Session');
      expect(row.textContent).toBe('claude-ses-xyz');
    });

    it('renders "-" for Claude Session when null', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({ session: makeSession({ claudeSessionId: null }) })}
        />,
      );
      const row = screen.getByTestId('detail-row-Claude Session');
      expect(row.textContent).toBe('-');
    });

    it('renders PID when present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-PID');
      expect(row.textContent).toBe('12345');
    });

    it('renders "-" for PID when null', () => {
      render(<SessionDetailPanel {...defaultProps({ session: makeSession({ pid: null }) })} />);
      const row = screen.getByTestId('detail-row-PID');
      expect(row.textContent).toBe('-');
    });

    it('renders model in detail row', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Model');
      expect(row.textContent).toBe('claude-sonnet-4-6');
    });

    it('renders "(default)" when model is null', () => {
      render(<SessionDetailPanel {...defaultProps({ session: makeSession({ model: null }) })} />);
      const row = screen.getByTestId('detail-row-Model');
      expect(row.textContent).toBe('(default)');
    });

    it('renders Started date formatted', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Started');
      expect(row.textContent).toBe('formatted:2026-03-07T10:00:00Z');
    });

    it('renders Ended date when session has endedAt', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ endedAt: '2026-03-07T11:00:00Z', status: 'ended' }),
          })}
        />,
      );
      const row = screen.getByTestId('detail-row-Ended');
      expect(row.textContent).toBe('formatted:2026-03-07T11:00:00Z');
    });

    it('does not render Ended row when endedAt is null', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.queryByTestId('detail-row-Ended')).toBeNull();
    });

    it('renders Duration row', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const row = screen.getByTestId('detail-row-Duration');
      expect(row.textContent).toBe('ongoing');
    });

    it('renders Forked From when metadata.forkedFrom is present', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ metadata: { forkedFrom: 'ses-parent-123' } }),
          })}
        />,
      );
      const row = screen.getByTestId('detail-row-Forked From');
      expect(row.textContent).toBe('ses-parent-123');
    });

    it('does not render Forked From when not present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.queryByTestId('detail-row-Forked From')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Account display
  // -------------------------------------------------------------------------
  describe('account display', () => {
    it('renders account name when accountId matches an account', () => {
      const accounts = [makeAccount({ id: 'acct-1', name: 'My Anthropic' })];
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ accountId: 'acct-1' }),
            accounts,
          })}
        />,
      );
      const row = screen.getByTestId('detail-row-Account');
      expect(row.textContent).toBe('My Anthropic');
    });

    it('renders raw accountId when no matching account found', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ accountId: 'acct-unknown' }),
            accounts: [],
          })}
        />,
      );
      const row = screen.getByTestId('detail-row-Account');
      expect(row.textContent).toBe('acct-unknown');
    });

    it('does not render Account row when accountId is null', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ accountId: null }) })} />,
      );
      expect(screen.queryByTestId('detail-row-Account')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Git status badge
  // -------------------------------------------------------------------------
  describe('git status badge', () => {
    it('renders GitStatusBadge when projectPath and machineId are present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const badge = screen.getByTestId('git-status-badge');
      expect(badge.textContent).toBe('mac-mini-1:/home/user/project');
    });

    it('does not render GitStatusBadge when projectPath is null', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ projectPath: null }) })} />,
      );
      expect(screen.queryByTestId('git-status-badge')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Error display
  // -------------------------------------------------------------------------
  describe('error status', () => {
    it('renders error message when status is error and metadata has errorMessage', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({
              status: 'error',
              metadata: { errorMessage: 'Process crashed' },
            }),
          })}
        />,
      );
      expect(screen.getByText('Error:')).toBeDefined();
      expect(screen.getByText('Process crashed')).toBeDefined();
    });

    it('renders "Unknown error" when status is error but no errorMessage', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'error', metadata: {} }),
          })}
        />,
      );
      expect(screen.getByText('Unknown error')).toBeDefined();
    });

    it('does not render error box when status is not error', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
          })}
        />,
      );
      expect(screen.queryByText('Error:')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Starting indicator
  // -------------------------------------------------------------------------
  describe('starting status', () => {
    it('renders starting indicator when status is starting', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'starting' }),
          })}
        />,
      );
      expect(screen.getByText(/Session is starting/)).toBeDefined();
    });

    it('does not render starting indicator for active sessions', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.queryByText(/Session is starting/)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // End Session button (ConfirmButton)
  // -------------------------------------------------------------------------
  describe('end session button', () => {
    it('renders End Session button for active sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'active' }) })} />,
      );
      const btn = screen.getByTestId('confirm-button');
      expect(btn.textContent).toBe('End Session');
    });

    it('renders End Session button for starting sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'starting' }) })} />,
      );
      const btn = screen.getByTestId('confirm-button');
      expect(btn.textContent).toBe('End Session');
    });

    it('does not render End Session button for ended sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
          })}
        />,
      );
      expect(screen.queryByTestId('confirm-button')).toBeNull();
    });

    it('does not render End Session button for error sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'error', metadata: {} }),
          })}
        />,
      );
      expect(screen.queryByTestId('confirm-button')).toBeNull();
    });

    it('calls onStop when End Session is confirmed', () => {
      const onStop = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({ onStop, session: makeSession({ status: 'active' }) })}
        />,
      );
      fireEvent.click(screen.getByTestId('confirm-button'));
      expect(onStop).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Create Agent button
  // -------------------------------------------------------------------------
  describe('create agent button', () => {
    it('renders "Create Agent" button', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      expect(screen.getByText('Create Agent')).toBeDefined();
    });

    it('shows "Loading..." when forkPickerLoading is true', () => {
      render(<SessionDetailPanel {...defaultProps({ forkPickerLoading: true })} />);
      expect(screen.getByText('Loading...')).toBeDefined();
    });

    it('calls onOpenForkPicker when session has claudeSessionId and machineId', () => {
      const onOpenForkPicker = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            onOpenForkPicker,
            session: makeSession({ claudeSessionId: 'cid', machineId: 'mid' }),
          })}
        />,
      );
      // The "Create Agent" text is in the button (not the ConvertToAgentForm mock)
      const buttons = screen.getAllByText('Create Agent');
      // Find the header button (not the form mock)
      const headerBtn = buttons.find(
        (el) => el.closest('[data-testid="convert-to-agent-form"]') === null,
      );
      expect(headerBtn).toBeDefined();
      if (headerBtn) fireEvent.click(headerBtn);
      expect(onOpenForkPicker).toHaveBeenCalledOnce();
    });

    it('calls onOpenConvertDialog when session has no claudeSessionId', () => {
      const onOpenConvertDialog = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            onOpenConvertDialog,
            session: makeSession({ claudeSessionId: null }),
          })}
        />,
      );
      fireEvent.click(screen.getByText('Create Agent'));
      expect(onOpenConvertDialog).toHaveBeenCalledOnce();
    });

    it('disables create agent button when forkPickerLoading is true', () => {
      render(<SessionDetailPanel {...defaultProps({ forkPickerLoading: true })} />);
      const btn = screen.getByText('Loading...');
      expect(btn.closest('button')?.hasAttribute('disabled')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ConvertToAgentForm visibility
  // -------------------------------------------------------------------------
  describe('convert to agent form', () => {
    it('renders ConvertToAgentForm when showConvertDialog is true', () => {
      render(<SessionDetailPanel {...defaultProps({ showConvertDialog: true })} />);
      expect(screen.getByTestId('convert-to-agent-form')).toBeDefined();
    });

    it('does not render ConvertToAgentForm when showConvertDialog is false', () => {
      render(<SessionDetailPanel {...defaultProps({ showConvertDialog: false })} />);
      expect(screen.queryByTestId('convert-to-agent-form')).toBeNull();
    });

    it('passes convertName to ConvertToAgentForm', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({ showConvertDialog: true, convertName: 'my-bot' })}
        />,
      );
      expect(screen.getByTestId('convert-name').textContent).toBe('my-bot');
    });

    it('calls onConvertToAgent when form submit is clicked', () => {
      const onConvertToAgent = vi.fn();
      render(
        <SessionDetailPanel {...defaultProps({ showConvertDialog: true, onConvertToAgent })} />,
      );
      fireEvent.click(screen.getByTestId('convert-submit'));
      expect(onConvertToAgent).toHaveBeenCalledOnce();
    });

    it('calls onCloseConvertDialog when form cancel is clicked', () => {
      const onCloseConvertDialog = vi.fn();
      render(
        <SessionDetailPanel {...defaultProps({ showConvertDialog: true, onCloseConvertDialog })} />,
      );
      fireEvent.click(screen.getByTestId('convert-cancel'));
      expect(onCloseConvertDialog).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // SessionContent
  // -------------------------------------------------------------------------
  describe('session content', () => {
    it('renders SessionContent when claudeSessionId and machineId are present', () => {
      render(<SessionDetailPanel {...defaultProps()} />);
      const content = screen.getByTestId('session-content');
      expect(content.textContent).toBe('claude-ses-xyz|ses-abc123def456|mac-mini-1');
    });

    it('does not render SessionContent when claudeSessionId is null', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({ session: makeSession({ claudeSessionId: null }) })}
        />,
      );
      expect(screen.queryByTestId('session-content')).toBeNull();
    });

    it('shows "No conversation content available" for ended session without claudeSessionId', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({
              claudeSessionId: null,
              status: 'ended',
              endedAt: '2026-03-07T11:00:00Z',
            }),
          })}
        />,
      );
      expect(screen.getByText('No conversation content available')).toBeDefined();
    });

    it('shows "Session failed before the CLI process started" for error without claudeSessionId', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({
              claudeSessionId: null,
              status: 'error',
              metadata: { errorMessage: 'spawn failed' },
            }),
          })}
        />,
      );
      expect(screen.getByText('Session failed before the CLI process started')).toBeDefined();
    });

    it('shows error message below failure text for error without claudeSessionId', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({
              claudeSessionId: null,
              status: 'error',
              metadata: { errorMessage: 'spawn failed' },
            }),
          })}
        />,
      );
      expect(screen.getAllByText('spawn failed').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "Waiting for CLI to initialize..." for starting without claudeSessionId', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ claudeSessionId: null, status: 'starting' }),
          })}
        />,
      );
      expect(screen.getByText('Waiting for CLI to initialize...')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Prompt input — active session
  // -------------------------------------------------------------------------
  describe('prompt input (active session)', () => {
    it('renders prompt input for active sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'active' }) })} />,
      );
      expect(screen.getByLabelText('Message to send to session')).toBeDefined();
    });

    it('uses "Send message..." placeholder for active sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'active' }) })} />,
      );
      expect(screen.getByPlaceholderText('Send message...')).toBeDefined();
    });

    it('reflects current prompt value', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            prompt: 'fix the tests',
          })}
        />,
      );
      const input = screen.getByLabelText('Message to send to session') as HTMLInputElement;
      expect(input.value).toBe('fix the tests');
    });

    it('calls onPromptChange when typing', () => {
      const onPromptChange = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            onPromptChange,
          })}
        />,
      );
      fireEvent.change(screen.getByLabelText('Message to send to session'), {
        target: { value: 'hello' },
      });
      expect(onPromptChange).toHaveBeenCalledWith('hello');
    });

    it('renders "Send" button for active sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'active' }) })} />,
      );
      expect(screen.getByLabelText('Send message')).toBeDefined();
      expect(screen.getByText('Send')).toBeDefined();
    });

    it('calls onSend when Send button is clicked', () => {
      const onSend = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            prompt: 'do something',
            onSend,
          })}
        />,
      );
      fireEvent.click(screen.getByLabelText('Send message'));
      expect(onSend).toHaveBeenCalledOnce();
    });

    it('calls onSend when Enter is pressed in the input', () => {
      const onSend = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            prompt: 'do it',
            onSend,
          })}
        />,
      );
      fireEvent.keyDown(screen.getByLabelText('Message to send to session'), { key: 'Enter' });
      expect(onSend).toHaveBeenCalledOnce();
    });

    it('does not call onSend on Shift+Enter', () => {
      const onSend = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            prompt: 'do it',
            onSend,
          })}
        />,
      );
      fireEvent.keyDown(screen.getByLabelText('Message to send to session'), {
        key: 'Enter',
        shiftKey: true,
      });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('disables Send button when prompt is empty', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({ session: makeSession({ status: 'active' }), prompt: '' })}
        />,
      );
      const btn = screen.getByLabelText('Send message');
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('disables Send button when prompt is whitespace only', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({ session: makeSession({ status: 'active' }), prompt: '   ' })}
        />,
      );
      const btn = screen.getByLabelText('Send message');
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('disables Send button when sending is true', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            prompt: 'something',
            sending: true,
          })}
        />,
      );
      const btn = screen.getByLabelText('Send message');
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('shows "..." text when sending is true', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'active' }),
            prompt: 'x',
            sending: true,
          })}
        />,
      );
      expect(screen.getByText('...')).toBeDefined();
    });

    it('does not render model selector for active sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'active' }) })} />,
      );
      expect(screen.queryByLabelText('Resume model')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Prompt input — ended/error session (resume)
  // -------------------------------------------------------------------------
  describe('prompt input (ended/error session — resume)', () => {
    it('renders prompt input for ended sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
          })}
        />,
      );
      expect(screen.getByLabelText('Prompt to resume session')).toBeDefined();
    });

    it('renders prompt input for error sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'error', metadata: {} }),
          })}
        />,
      );
      expect(screen.getByLabelText('Prompt to resume session')).toBeDefined();
    });

    it('does not render prompt input for starting sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'starting' }) })} />,
      );
      expect(screen.queryByLabelText('Prompt to resume session')).toBeNull();
      expect(screen.queryByLabelText('Message to send to session')).toBeNull();
    });

    it('uses "Resume session with prompt..." placeholder for ended sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
          })}
        />,
      );
      expect(screen.getByPlaceholderText('Resume session with prompt...')).toBeDefined();
    });

    it('renders "Resume" button for ended sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
          })}
        />,
      );
      expect(screen.getByLabelText('Resume session')).toBeDefined();
      expect(screen.getByText('Resume')).toBeDefined();
    });

    it('renders model selector for ended sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
          })}
        />,
      );
      expect(screen.getByLabelText('Resume model')).toBeDefined();
    });

    it('renders model selector for error sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'error', metadata: {} }),
          })}
        />,
      );
      expect(screen.getByLabelText('Resume model')).toBeDefined();
    });

    it('reflects resumeModel value in model selector', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
            resumeModel: 'claude-sonnet-4-6',
          })}
        />,
      );
      const select = screen.getByLabelText('Resume model') as HTMLSelectElement;
      expect(select.value).toBe('claude-sonnet-4-6');
    });

    it('calls onResumeModelChange when model selector changes', () => {
      const onResumeModelChange = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
            onResumeModelChange,
          })}
        />,
      );
      fireEvent.change(screen.getByLabelText('Resume model'), {
        target: { value: 'claude-opus-4-6' },
      });
      expect(onResumeModelChange).toHaveBeenCalledWith('claude-opus-4-6');
    });

    it('renders "Keep current" option in model selector that includes current model', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({
              status: 'ended',
              endedAt: '2026-03-07T11:00:00Z',
              model: 'claude-sonnet-4-6',
            }),
          })}
        />,
      );
      const options = screen.getByLabelText('Resume model').querySelectorAll('option');
      expect(options[0]?.textContent).toContain('Keep current');
      expect(options[0]?.textContent).toContain('claude-sonnet-4-6');
    });

    it('calls onSend when Resume button is clicked', () => {
      const onSend = vi.fn();
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
            prompt: 'continue',
            onSend,
          })}
        />,
      );
      fireEvent.click(screen.getByLabelText('Resume session'));
      expect(onSend).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // No prompt input for non-applicable statuses
  // -------------------------------------------------------------------------
  describe('prompt input visibility by status', () => {
    it('does not render prompt input for starting sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'starting' }) })} />,
      );
      expect(screen.queryByPlaceholderText('Send message...')).toBeNull();
      expect(screen.queryByPlaceholderText('Resume session with prompt...')).toBeNull();
    });

    it('renders prompt input for active sessions', () => {
      render(
        <SessionDetailPanel {...defaultProps({ session: makeSession({ status: 'active' }) })} />,
      );
      expect(screen.getByPlaceholderText('Send message...')).toBeDefined();
    });

    it('renders prompt input for ended sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'ended', endedAt: '2026-03-07T11:00:00Z' }),
          })}
        />,
      );
      expect(screen.getByPlaceholderText('Resume session with prompt...')).toBeDefined();
    });

    it('renders prompt input for error sessions', () => {
      render(
        <SessionDetailPanel
          {...defaultProps({
            session: makeSession({ status: 'error', metadata: {} }),
          })}
        />,
      );
      expect(screen.getByPlaceholderText('Resume session with prompt...')).toBeDefined();
    });
  });
});
