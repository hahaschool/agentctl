import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before any vi.mock() calls
// ---------------------------------------------------------------------------

const {
  mockSendMessageMutate,
  mockResumeSessionMutate,
  mockUseSendMessage,
  mockUseResumeSession,
  mockInvalidateQueries,
  mockClipboardImageToAttachment,
  mockFileToAttachment,
} = vi.hoisted(() => ({
  mockSendMessageMutate: vi.fn(),
  mockResumeSessionMutate: vi.fn(),
  mockUseSendMessage: vi.fn(),
  mockUseResumeSession: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockClipboardImageToAttachment: vi.fn(),
  mockFileToAttachment: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock('./Toast', () => ({
  useToast: () => mockToast,
  ToastContainer: () => null,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock('../lib/queries', () => ({
  queryKeys: {
    session: (id: string) => ['sessions', id],
    sessions: () => ['sessions'],
  },
  useSendMessage: () => mockUseSendMessage(),
  useResumeSession: () => mockUseResumeSession(),
}));

vi.mock('../lib/api', () => ({
  clipboardImageToAttachment: (...args: unknown[]) => mockClipboardImageToAttachment(...args),
  fileToAttachment: (...args: unknown[]) => mockFileToAttachment(...args),
}));

vi.mock('../lib/format-utils', () => ({
  formatFileSize: (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  },
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import type { Attachment, Session } from '../lib/api';
import { MessageInput } from './MessageInput';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-abc123',
    agentId: 'agent-1',
    agentName: 'test-agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'active',
    projectPath: '/home/user/project',
    pid: 1234,
    startedAt: '2026-03-07T00:00:00Z',
    lastHeartbeat: '2026-03-07T00:01:00Z',
    endedAt: null,
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    name: 'test-file.txt',
    type: 'file',
    size: 1024,
    content: 'file contents here',
    isBase64: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInput(
  sessionOverrides: Partial<Session> = {},
  onOptimisticSend?: (text: string) => void,
) {
  const session = makeSession(sessionOverrides);
  const result = render(<MessageInput session={session} onOptimisticSend={onOptimisticSend} />);
  return { ...result, session };
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/send a message|resume session/i) as HTMLTextAreaElement;
}

function getSendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /send|resume/i }) as HTMLButtonElement;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSendMessageMutate.mockReset();
  mockResumeSessionMutate.mockReset();
  mockInvalidateQueries.mockReset();
  mockClipboardImageToAttachment.mockReset();
  mockFileToAttachment.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  mockToast.info.mockReset();

  mockUseSendMessage.mockReturnValue({
    mutate: mockSendMessageMutate,
    isPending: false,
  });
  mockUseResumeSession.mockReturnValue({
    mutate: mockResumeSessionMutate,
    isPending: false,
  });

  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('MessageInput', () => {
  // -----------------------------------------------------------------------
  // 1. Rendering
  // -----------------------------------------------------------------------

  describe('rendering', () => {
    it('renders the textarea for an active session', () => {
      renderInput();
      const textarea = getTextarea();
      expect(textarea).toBeDefined();
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('renders the Send button for an active session', () => {
      renderInput();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
    });

    it('shows active placeholder text when session is active', () => {
      renderInput({ status: 'active' });
      const textarea = getTextarea();
      expect(textarea.placeholder).toContain('Send a message');
    });

    it('shows resume placeholder text when session is ended', () => {
      renderInput({ status: 'ended' });
      const textarea = screen.getByPlaceholderText(/resume session/i);
      expect(textarea).toBeDefined();
    });

    it('shows the Attach file button', () => {
      renderInput();
      expect(screen.getByRole('button', { name: 'Attach file' })).toBeDefined();
    });

    it('shows the hint text about Enter and Shift+Enter', () => {
      renderInput();
      expect(screen.getByText(/Enter to send/)).toBeDefined();
      expect(screen.getByText(/Shift\+Enter for newline/)).toBeDefined();
    });

    it('renders "Resume" button text when session is resumable', () => {
      renderInput({ status: 'ended' });
      expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Sending a message (submit)
  // -----------------------------------------------------------------------

  describe('sending a message', () => {
    it('calls sendMessage.mutate with correct id and message', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Hello world' } });
      fireEvent.click(getSendButton());

      expect(mockSendMessageMutate).toHaveBeenCalledTimes(1);
      expect(mockSendMessageMutate).toHaveBeenCalledWith(
        { id: 'ses-abc123', message: 'Hello world' },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });

    it('calls onOptimisticSend with the message text', () => {
      const onOptimisticSend = vi.fn();
      renderInput({}, onOptimisticSend);
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Quick update' } });
      fireEvent.click(getSendButton());

      expect(onOptimisticSend).toHaveBeenCalledWith('Quick update');
    });

    it('trims whitespace from the message before sending', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
      fireEvent.click(getSendButton());

      expect(mockSendMessageMutate).toHaveBeenCalledWith(
        { id: 'ses-abc123', message: 'Hello world' },
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 3. Empty message validation
  // -----------------------------------------------------------------------

  describe('empty message validation', () => {
    it('does not send when message is empty', () => {
      renderInput();
      fireEvent.click(getSendButton());
      expect(mockSendMessageMutate).not.toHaveBeenCalled();
    });

    it('does not send when message is whitespace-only', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: '   ' } });
      fireEvent.click(getSendButton());
      expect(mockSendMessageMutate).not.toHaveBeenCalled();
    });

    it('disables Send button when message is empty and no attachments', () => {
      renderInput();
      const button = getSendButton();
      expect(button.disabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. File attachment UI
  // -----------------------------------------------------------------------

  describe('file attachments', () => {
    it('shows attachment previews when files are added', async () => {
      const attachment = makeAttachment({ name: 'readme.md', size: 2048 });
      mockFileToAttachment.mockResolvedValue(attachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['test'], 'readme.md', { type: 'text/markdown' });
      Object.defineProperty(file, 'size', { value: 2048 });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('readme.md')).toBeDefined();
      });
    });

    it('shows remove button for each attachment', async () => {
      const attachment = makeAttachment({ name: 'data.json', size: 512 });
      mockFileToAttachment.mockResolvedValue(attachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['{}'], 'data.json', { type: 'application/json' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Remove data.json' })).toBeDefined();
      });
    });

    it('removes attachment when remove button is clicked', async () => {
      const attachment = makeAttachment({ name: 'old.txt', size: 100 });
      mockFileToAttachment.mockResolvedValue(attachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['hello'], 'old.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('old.txt')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Remove old.txt' }));
      expect(screen.queryByText('old.txt')).toBeNull();
    });

    it('rejects files larger than 10 MB with a toast error', async () => {
      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      const largeFile = new File(['x'], 'huge.bin', { type: 'application/octet-stream' });
      Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });
      fireEvent.change(fileInput, { target: { files: [largeFile] } });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('huge.bin is too large (max 10 MB)');
      });
      expect(mockFileToAttachment).not.toHaveBeenCalled();
    });

    it('shows toast error when file read fails', async () => {
      mockFileToAttachment.mockRejectedValue(new Error('read error'));

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], 'bad.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to read bad.txt');
      });
    });

    it('enables Send button when attachment is present even without text', async () => {
      const attachment = makeAttachment({ name: 'file.txt', size: 100 });
      mockFileToAttachment.mockResolvedValue(attachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], 'file.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        const button = getSendButton();
        expect(button.disabled).toBe(false);
      });
    });

    it('includes attachment descriptions in the sent message', async () => {
      const attachment = makeAttachment({
        name: 'notes.txt',
        size: 256,
        content: 'some notes',
        isBase64: false,
        type: 'file',
      });
      mockFileToAttachment.mockResolvedValue(attachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['some notes'], 'notes.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('notes.txt')).toBeDefined();
      });

      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Check this file' } });
      fireEvent.click(getSendButton());

      expect(mockSendMessageMutate).toHaveBeenCalledTimes(1);
      const call = mockSendMessageMutate.mock.calls[0] as Array<{ message: string }>;
      const sentMessage = call?.[0]?.message;
      expect(sentMessage).toContain('Check this file');
      expect(sentMessage).toContain('[Attached file: notes.txt]');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Paste handling
  // -----------------------------------------------------------------------

  describe('paste handling', () => {
    it('handles image paste from clipboard', async () => {
      const attachment = makeAttachment({
        name: 'clipboard-123.png',
        type: 'image',
        size: 5000,
      });
      mockClipboardImageToAttachment.mockResolvedValue(attachment);

      renderInput();
      const textarea = getTextarea();

      const blob = new Blob(['fake-image'], { type: 'image/png' });
      const file = new File([blob], 'image.png', { type: 'image/png' });

      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => file,
            },
          ],
        },
      });
      Object.defineProperty(pasteEvent, 'preventDefault', { value: vi.fn() });

      fireEvent(textarea, pasteEvent);

      await waitFor(() => {
        expect(mockClipboardImageToAttachment).toHaveBeenCalledWith(file);
        expect(mockToast.success).toHaveBeenCalledWith('Image pasted: clipboard-123.png');
      });
    });

    it('shows error toast when image paste fails', async () => {
      mockClipboardImageToAttachment.mockRejectedValue(new Error('read failed'));

      renderInput();
      const textarea = getTextarea();

      const blob = new Blob(['fake'], { type: 'image/png' });
      const file = new File([blob], 'bad.png', { type: 'image/png' });

      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => file,
            },
          ],
        },
      });
      Object.defineProperty(pasteEvent, 'preventDefault', { value: vi.fn() });

      fireEvent(textarea, pasteEvent);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to read pasted image');
      });
    });

    it('does not intercept paste when item is not an image', () => {
      renderInput();
      const textarea = getTextarea();

      const pasteEvent = new Event('paste', { bubbles: true });
      const preventDefaultSpy = vi.fn();
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              type: 'text/plain',
              getAsFile: () => null,
            },
          ],
        },
      });
      Object.defineProperty(pasteEvent, 'preventDefault', { value: preventDefaultSpy });

      fireEvent(textarea, pasteEvent);

      expect(mockClipboardImageToAttachment).not.toHaveBeenCalled();
      // preventDefault should NOT be called for non-image paste
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Draft persistence (sessionStorage)
  // -----------------------------------------------------------------------

  describe('draft persistence', () => {
    it('loads saved draft from sessionStorage on mount', () => {
      sessionStorage.setItem('draft:ses-abc123', 'Previously typed text');
      renderInput();
      const textarea = getTextarea();
      expect(textarea.value).toBe('Previously typed text');
    });

    it('saves draft to sessionStorage after typing (debounced)', async () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Work in progress' } });

      // Wait for the 300ms debounce
      await waitFor(() => {
        expect(sessionStorage.getItem('draft:ses-abc123')).toBe('Work in progress');
      });
    });

    it('removes draft from sessionStorage when text is cleared', async () => {
      sessionStorage.setItem('draft:ses-abc123', 'old draft');
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: '' } });

      await waitFor(() => {
        expect(sessionStorage.getItem('draft:ses-abc123')).toBeNull();
      });
    });

    it('clears draft from sessionStorage on successful send', () => {
      sessionStorage.setItem('draft:ses-abc123', 'will be cleared');

      // Make mutate synchronously call onSuccess
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess?: () => void }) => {
          opts.onSuccess?.();
        },
      );

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Final message' } });
      fireEvent.click(getSendButton());

      expect(sessionStorage.getItem('draft:ses-abc123')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Resume model selector
  // -----------------------------------------------------------------------

  describe('resume model selector', () => {
    it('shows model selector when session is ended', () => {
      renderInput({ status: 'ended' });
      expect(screen.getByLabelText('Resume model')).toBeDefined();
    });

    it('shows model selector when session is paused', () => {
      renderInput({ status: 'paused' });
      expect(screen.getByLabelText('Resume model')).toBeDefined();
    });

    it('shows model selector when session has error status', () => {
      renderInput({ status: 'error' });
      expect(screen.getByLabelText('Resume model')).toBeDefined();
    });

    it('does not show model selector when session is active', () => {
      renderInput({ status: 'active' });
      expect(screen.queryByLabelText('Resume model')).toBeNull();
    });

    it('defaults to "Keep current model"', () => {
      renderInput({ status: 'ended' });
      const select = screen.getByLabelText('Resume model') as HTMLSelectElement;
      expect(select.value).toBe('');
    });

    it('lists all model options', () => {
      renderInput({ status: 'ended' });
      expect(screen.getByText('Keep current model')).toBeDefined();
      expect(screen.getByText('Claude Sonnet 4.6')).toBeDefined();
      expect(screen.getByText('Claude Opus 4.6')).toBeDefined();
      expect(screen.getByText('Claude Haiku 4.5')).toBeDefined();
    });

    it('sends selected model when resuming session', () => {
      renderInput({ status: 'ended' });
      const select = screen.getByLabelText('Resume model') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'claude-opus-4-6' } });

      const textarea = screen.getByPlaceholderText(/resume session/i);
      fireEvent.change(textarea, { target: { value: 'Continue where you left off' } });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockResumeSessionMutate).toHaveBeenCalledWith(
        { id: 'ses-abc123', prompt: 'Continue where you left off', model: 'claude-opus-4-6' },
        expect.any(Object),
      );
    });

    it('sends model as undefined when "Keep current model" is selected', () => {
      renderInput({ status: 'ended' });
      const textarea = screen.getByPlaceholderText(/resume session/i);
      fireEvent.change(textarea, { target: { value: 'Resume' } });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockResumeSessionMutate).toHaveBeenCalledWith(
        { id: 'ses-abc123', prompt: 'Resume', model: undefined },
        expect.any(Object),
      );
    });

    it('displays the current session model', () => {
      renderInput({ status: 'ended', model: 'claude-sonnet-4-6' });
      expect(screen.getByText(/Current: claude-sonnet-4-6/)).toBeDefined();
    });

    it('shows "default" when session model is null', () => {
      renderInput({ status: 'ended', model: null });
      expect(screen.getByText(/Current: default/)).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Keyboard shortcuts
  // -----------------------------------------------------------------------

  describe('keyboard shortcuts', () => {
    it('sends message on Enter key', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Enter test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(mockSendMessageMutate).toHaveBeenCalledTimes(1);
    });

    it('does not send on Shift+Enter (allows newline)', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Multi\nline' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(mockSendMessageMutate).not.toHaveBeenCalled();
    });

    it('does not send during IME composition', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'partial' } });

      // Start IME composition
      fireEvent.compositionStart(textarea);
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(mockSendMessageMutate).not.toHaveBeenCalled();
    });

    it('sends after IME composition ends', () => {
      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'composed text' } });

      fireEvent.compositionStart(textarea);
      fireEvent.compositionEnd(textarea);
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(mockSendMessageMutate).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Sending state (disabled while sending)
  // -----------------------------------------------------------------------

  describe('sending state', () => {
    it('shows "Sending..." text when sendMessage is pending', () => {
      mockUseSendMessage.mockReturnValue({
        mutate: mockSendMessageMutate,
        isPending: true,
      });

      renderInput();
      expect(screen.getByText('Sending...')).toBeDefined();
    });

    it('disables textarea while sending', () => {
      mockUseSendMessage.mockReturnValue({
        mutate: mockSendMessageMutate,
        isPending: true,
      });

      renderInput();
      const textarea = getTextarea();
      expect(textarea.disabled).toBe(true);
    });

    it('disables Send button while sending', () => {
      mockUseSendMessage.mockReturnValue({
        mutate: mockSendMessageMutate,
        isPending: true,
      });

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'test' } });
      // Re-query the button since re-render happened
      const buttons = screen.getAllByRole('button');
      const sendButton = buttons.find((b) => b.textContent === 'Sending...');
      expect(sendButton).toBeDefined();
    });

    it('does not call mutate when already sending', () => {
      mockUseSendMessage.mockReturnValue({
        mutate: mockSendMessageMutate,
        isPending: true,
      });

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(mockSendMessageMutate).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 10. Clear input after send
  // -----------------------------------------------------------------------

  describe('clear input after send', () => {
    it('clears the textarea on successful send', () => {
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess?: () => void }) => {
          opts.onSuccess?.();
        },
      );

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Clear me' } });
      fireEvent.click(getSendButton());

      expect(textarea.value).toBe('');
    });

    it('clears attachments on successful send', async () => {
      const attachment = makeAttachment({ name: 'will-clear.txt', size: 100 });
      mockFileToAttachment.mockResolvedValue(attachment);
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess?: () => void }) => {
          opts.onSuccess?.();
        },
      );

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], 'will-clear.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('will-clear.txt')).toBeDefined();
      });

      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'msg' } });
      fireEvent.click(getSendButton());

      expect(screen.queryByText('will-clear.txt')).toBeNull();
    });

    it('does not clear textarea on send error', () => {
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(new Error('Network failure'));
        },
      );

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'Keep me' } });
      fireEvent.click(getSendButton());

      // Message should remain since send failed
      expect(textarea.value).toBe('Keep me');
    });
  });

  // -----------------------------------------------------------------------
  // 11. Session status edge cases
  // -----------------------------------------------------------------------

  describe('session status states', () => {
    it('shows "Session is starting" message when status is starting', () => {
      renderInput({ status: 'starting' });
      expect(screen.getByText(/Session is starting/)).toBeDefined();
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('shows "Cannot send messages" for non-sendable status', () => {
      renderInput({ status: 'stopped' });
      expect(screen.getByText(/Cannot send messages/)).toBeDefined();
    });

    it('shows session-lost banner when session was lost', () => {
      sessionStorage.setItem('lost:ses-abc123', '1');
      renderInput({ status: 'ended' });
      expect(screen.getByText(/session was lost/i)).toBeDefined();
    });

    it('marks session as lost on SESSION_LOST error', () => {
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(new Error('session was lost due to restart'));
        },
      );

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.click(getSendButton());

      expect(sessionStorage.getItem('lost:ses-abc123')).toBe('1');
    });
  });

  // -----------------------------------------------------------------------
  // 12. Error handling on send failure
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('shows toast on send error', () => {
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(new Error('Server unavailable'));
        },
      );

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.click(getSendButton());

      expect(mockToast.error).toHaveBeenCalledWith('Server unavailable');
    });

    it('shows toast on resume error', () => {
      mockResumeSessionMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(new Error('Resume failed'));
        },
      );

      renderInput({ status: 'ended' });
      const textarea = screen.getByPlaceholderText(/resume session/i);
      fireEvent.change(textarea, { target: { value: 'continue' } });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockToast.error).toHaveBeenCalledWith('Resume failed');
    });

    it('invalidates session query on error to refresh UI', () => {
      mockSendMessageMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(new Error('fail'));
        },
      );

      renderInput();
      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.click(getSendButton());

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['sessions', 'ses-abc123'],
      });
    });

    it('shows toast success on resume success', () => {
      mockResumeSessionMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess?: () => void }) => {
          opts.onSuccess?.();
        },
      );

      renderInput({ status: 'ended' });
      const textarea = screen.getByPlaceholderText(/resume session/i);
      fireEvent.change(textarea, { target: { value: 'continue work' } });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockToast.success).toHaveBeenCalledWith('Session resumed');
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('can send with only attachments (no text)', async () => {
      const attachment = makeAttachment({
        name: 'solo.txt',
        size: 50,
        content: 'hi',
        isBase64: false,
      });
      mockFileToAttachment.mockResolvedValue(attachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['hi'], 'solo.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('solo.txt')).toBeDefined();
      });

      fireEvent.click(getSendButton());

      expect(mockSendMessageMutate).toHaveBeenCalledTimes(1);
      const sentMessage = (mockSendMessageMutate.mock.calls[0] as Array<{ message: string }>)?.[0]
        ?.message;
      expect(sentMessage).toContain('[Attached file: solo.txt]');
    });

    it('shows image attachment description for image type', async () => {
      const imgAttachment = makeAttachment({
        name: 'screenshot.png',
        type: 'image',
        size: 50000,
        isBase64: true,
      });
      mockFileToAttachment.mockResolvedValue(imgAttachment);

      renderInput();
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['img'], 'screenshot.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 50000 });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('screenshot.png')).toBeDefined();
      });

      const textarea = getTextarea();
      fireEvent.change(textarea, { target: { value: 'See image' } });
      fireEvent.click(getSendButton());

      const sentMessage = (mockSendMessageMutate.mock.calls[0] as Array<{ message: string }>)?.[0]
        ?.message;
      expect(sentMessage).toContain('[Attached image: screenshot.png');
    });

    it('uses resumeSession.mutate (not sendMessage) for ended sessions', () => {
      renderInput({ status: 'ended' });
      const textarea = screen.getByPlaceholderText(/resume session/i);
      fireEvent.change(textarea, { target: { value: 'resume prompt' } });
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockResumeSessionMutate).toHaveBeenCalledTimes(1);
      expect(mockSendMessageMutate).not.toHaveBeenCalled();
    });
  });
});
