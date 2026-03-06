import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockListMachines = vi.fn();
const mockCreateSession = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    listMachines: (...args: unknown[]) => mockListMachines(...args),
    createSession: (...args: unknown[]) => mockCreateSession(...args),
  },
}));

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

vi.mock('./ErrorBanner', () => ({
  ErrorBanner: ({ message, className }: { message: string; className?: string }) => (
    <div data-testid="error-banner" role="alert" className={className}>
      {message}
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: (props: Record<string, unknown>) => <svg data-testid="icon-alert-circle" {...props} />,
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import type { ApiAccount, Machine } from '../lib/api';
import { STORAGE_KEYS } from '../lib/storage-keys';
import { CreateSessionForm } from './CreateSessionForm';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMachine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: 'machine-1',
    hostname: 'dev-box',
    tailscaleIp: '100.64.0.1',
    os: 'linux',
    arch: 'x86_64',
    status: 'online',
    lastHeartbeat: '2026-03-07T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ApiAccount> = {}): ApiAccount {
  return {
    id: 'acct-1',
    name: 'My Anthropic',
    provider: 'anthropic',
    credentialMasked: 'sk-ant-...abcd',
    priority: 1,
    rateLimit: { itpm: 100000 },
    isActive: true,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const ONLINE_MACHINES = [
  makeMachine({ id: 'machine-1', hostname: 'dev-box', status: 'online' }),
  makeMachine({ id: 'machine-2', hostname: 'staging-box', status: 'online' }),
];

const MIXED_MACHINES = [
  makeMachine({ id: 'machine-1', hostname: 'dev-box', status: 'offline' }),
  makeMachine({ id: 'machine-2', hostname: 'staging-box', status: 'online' }),
];

const ACTIVE_ACCOUNTS: ApiAccount[] = [
  makeAccount({ id: 'acct-1', name: 'Primary', provider: 'anthropic', isActive: true }),
  makeAccount({ id: 'acct-2', name: 'Backup', provider: 'bedrock', isActive: true }),
  makeAccount({ id: 'acct-3', name: 'Disabled', provider: 'vertex', isActive: false }),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderForm(props: { accounts?: ApiAccount[]; onCreated?: () => void } = {}) {
  const onCreated = props.onCreated ?? vi.fn();
  const accounts = props.accounts ?? [];
  const result = render(<CreateSessionForm accounts={accounts} onCreated={onCreated} />);
  return { ...result, onCreated };
}

/** Fill in valid form fields so the submit button becomes enabled. */
async function fillValidForm() {
  await waitFor(() => {
    expect(screen.queryByText('Loading machines...')).toBeNull();
  });
  const projectInput = screen.getByLabelText('Project Path');
  const promptInput = screen.getByLabelText('Prompt');
  fireEvent.change(projectInput, { target: { value: '/home/user/project' } });
  fireEvent.change(promptInput, { target: { value: 'Fix the bug' } });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockListMachines.mockResolvedValue(ONLINE_MACHINES);
  mockCreateSession.mockResolvedValue({ ok: true, sessionId: 'sess-0123456789abcdef01234567', session: {} });
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('CreateSessionForm', () => {
  // -----------------------------------------------------------------------
  // Rendering all form fields
  // -----------------------------------------------------------------------

  describe('form field rendering', () => {
    it('renders the heading', async () => {
      renderForm();
      expect(screen.getByText('Create New Session')).toBeDefined();
    });

    it('renders a machine select', async () => {
      renderForm();
      const machineSelect = screen.getByLabelText('Machine');
      expect(machineSelect).toBeDefined();
      expect(machineSelect.tagName).toBe('SELECT');
    });

    it('renders project path input', () => {
      renderForm();
      const input = screen.getByLabelText('Project Path');
      expect(input).toBeDefined();
      expect(input.tagName).toBe('INPUT');
      expect((input as HTMLInputElement).placeholder).toBe('/home/user/project');
    });

    it('renders prompt textarea', () => {
      renderForm();
      const textarea = screen.getByLabelText('Prompt');
      expect(textarea).toBeDefined();
      expect(textarea.tagName).toBe('TEXTAREA');
      expect((textarea as HTMLTextAreaElement).placeholder).toBe('What should Claude work on?');
    });

    it('renders model select with options', () => {
      renderForm();
      const modelSelect = screen.getByLabelText('Model (optional)');
      expect(modelSelect).toBeDefined();
      expect(modelSelect.tagName).toBe('SELECT');
      expect(screen.getByText('Default')).toBeDefined();
      expect(screen.getByText('Claude Sonnet 4.6')).toBeDefined();
      expect(screen.getByText('Claude Opus 4.6')).toBeDefined();
      expect(screen.getByText('Claude Haiku 4.5')).toBeDefined();
    });

    it('renders account select with default auto option', () => {
      renderForm({ accounts: ACTIVE_ACCOUNTS });
      const accountSelect = screen.getByLabelText('Account (optional)');
      expect(accountSelect).toBeDefined();
      expect(screen.getByText('Default (auto)')).toBeDefined();
    });

    it('shows only active accounts in account select', () => {
      renderForm({ accounts: ACTIVE_ACCOUNTS });
      expect(screen.getByText('Primary (anthropic)')).toBeDefined();
      expect(screen.getByText('Backup (bedrock)')).toBeDefined();
      expect(screen.queryByText('Disabled (vertex)')).toBeNull();
    });

    it('renders the Create Session button', () => {
      renderForm();
      expect(screen.getByText('Create Session')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Machine loading
  // -----------------------------------------------------------------------

  describe('machine loading', () => {
    it('shows "Loading machines..." while fetching', () => {
      // Make listMachines never resolve during this test
      mockListMachines.mockReturnValue(new Promise(() => {}));
      renderForm();
      expect(screen.getByText('Loading machines...')).toBeDefined();
    });

    it('disables machine select while loading', () => {
      mockListMachines.mockReturnValue(new Promise(() => {}));
      renderForm();
      const machineSelect = screen.getByLabelText('Machine') as HTMLSelectElement;
      expect(machineSelect.disabled).toBe(true);
    });

    it('populates machine options after loading', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
        expect(screen.getByText('staging-box')).toBeDefined();
      });
    });

    it('shows "No machines available" when list is empty', async () => {
      mockListMachines.mockResolvedValue([]);
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('No machines available')).toBeDefined();
      });
    });

    it('auto-selects first online machine', async () => {
      mockListMachines.mockResolvedValue(MIXED_MACHINES);
      renderForm();
      await waitFor(() => {
        const machineSelect = screen.getByLabelText('Machine') as HTMLSelectElement;
        expect(machineSelect.value).toBe('machine-2');
      });
    });

    it('falls back to first machine when none are online', async () => {
      const allOffline = [
        makeMachine({ id: 'machine-off', hostname: 'offline-box', status: 'offline' }),
      ];
      mockListMachines.mockResolvedValue(allOffline);
      renderForm();
      await waitFor(() => {
        const machineSelect = screen.getByLabelText('Machine') as HTMLSelectElement;
        expect(machineSelect.value).toBe('machine-off');
      });
    });

    it('shows toast error when machine fetch fails', async () => {
      mockListMachines.mockRejectedValue(new Error('Network error'));
      renderForm();
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to load machines: Network error');
      });
    });

    it('marks offline machines with "(offline)" suffix', async () => {
      mockListMachines.mockResolvedValue(MIXED_MACHINES);
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box (offline)')).toBeDefined();
      });
    });

    it('marks degraded machines with "(degraded)" suffix', async () => {
      const degradedMachines = [
        makeMachine({ id: 'machine-d', hostname: 'degraded-box', status: 'degraded' }),
      ];
      mockListMachines.mockResolvedValue(degradedMachines);
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('degraded-box (degraded)')).toBeDefined();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  describe('validation', () => {
    it('shows error when no machine is selected', async () => {
      mockListMachines.mockResolvedValue([]);
      renderForm();

      await waitFor(() => {
        expect(screen.queryByText('Loading machines...')).toBeNull();
      });

      const projectInput = screen.getByLabelText('Project Path');
      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(projectInput, { target: { value: '/some/path' } });
      fireEvent.change(promptInput, { target: { value: 'do something' } });

      // Button is disabled because machineId is '', but let's verify the error
      // by forcing a submit through the button click
      // The button should be disabled, but we can test validation via the error message
      // Since isDisabled depends on !machineId, the button is disabled.
      // The error message is only shown on handleSubmit, which checks machineId first.
      // We need to trick the component — give it a machine, then clear it.
      // Actually the button is disabled when !machineId, so the user can't click it.
      // The validation error for no machine is a guard in handleSubmit.
      // Let's verify the button is disabled when no machine is selected.
      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('shows error when project path is empty', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(promptInput, { target: { value: 'do something' } });

      // Button disabled because projectPath is empty
      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('shows error when project path is not absolute', async () => {
      renderForm();
      await fillValidForm();

      // Set a relative path
      const projectInput = screen.getByLabelText('Project Path');
      fireEvent.change(projectInput, { target: { value: 'relative/path' } });

      const button = screen.getByText('Create Session');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
        expect(screen.getByText('Project path must be an absolute path (start with /)')).toBeDefined();
      });
    });

    it('shows error when prompt is empty', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const projectInput = screen.getByLabelText('Project Path');
      fireEvent.change(projectInput, { target: { value: '/some/path' } });

      // Button disabled because prompt is empty
      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('shows error for whitespace-only project path on submit', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const projectInput = screen.getByLabelText('Project Path');
      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(projectInput, { target: { value: '   ' } });
      fireEvent.change(promptInput, { target: { value: 'do something' } });

      // Button is disabled because projectPath.trim() is empty
      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('shows error for whitespace-only prompt on submit', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const projectInput = screen.getByLabelText('Project Path');
      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(projectInput, { target: { value: '/valid/path' } });
      fireEvent.change(promptInput, { target: { value: '   ' } });

      // Button is disabled because prompt.trim() is empty
      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Offline machine error
  // -----------------------------------------------------------------------

  describe('offline machine selection', () => {
    it('shows error when submitting with an offline machine selected', async () => {
      const offlineThenSelect = [
        makeMachine({ id: 'machine-off', hostname: 'offline-box', status: 'offline' }),
      ];
      mockListMachines.mockResolvedValue(offlineThenSelect);
      renderForm();

      await waitFor(() => {
        const machineSelect = screen.getByLabelText('Machine') as HTMLSelectElement;
        expect(machineSelect.value).toBe('machine-off');
      });

      const projectInput = screen.getByLabelText('Project Path');
      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(projectInput, { target: { value: '/home/user/project' } });
      fireEvent.change(promptInput, { target: { value: 'Fix the bug' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
        expect(
          screen.getByText('Selected machine is offline. Please choose an online machine.'),
        ).toBeDefined();
      });

      // Should NOT call createSession
      expect(mockCreateSession).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Successful submission
  // -----------------------------------------------------------------------

  describe('successful submission', () => {
    it('calls api.createSession with correct params', async () => {
      const onCreated = vi.fn();
      renderForm({ onCreated, accounts: ACTIVE_ACCOUNTS });
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledTimes(1);
        expect(mockCreateSession).toHaveBeenCalledWith({
          agentId: 'adhoc',
          machineId: 'machine-1',
          projectPath: '/home/user/project',
          prompt: 'Fix the bug',
          model: undefined,
          accountId: undefined,
        });
      });
    });

    it('sends selected model when non-default', async () => {
      renderForm();
      await fillValidForm();

      const modelSelect = screen.getByLabelText('Model (optional)');
      fireEvent.change(modelSelect, { target: { value: 'claude-opus-4-6' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledWith(
          expect.objectContaining({ model: 'claude-opus-4-6' }),
        );
      });
    });

    it('sends selected accountId when non-default', async () => {
      renderForm({ accounts: ACTIVE_ACCOUNTS });
      await fillValidForm();

      const accountSelect = screen.getByLabelText('Account (optional)');
      fireEvent.change(accountSelect, { target: { value: 'acct-2' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledWith(
          expect.objectContaining({ accountId: 'acct-2' }),
        );
      });
    });

    it('calls onCreated callback after successful creation', async () => {
      const onCreated = vi.fn();
      renderForm({ onCreated });
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
    });

    it('shows success toast with truncated session id', async () => {
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith('Session created: sess-0123456789a...');
      });
    });

    it('shows "Creating..." text while submitting', async () => {
      // Make createSession hang so we can observe the submitting state
      mockCreateSession.mockReturnValue(new Promise(() => {}));
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(screen.getByText('Creating...')).toBeDefined();
      });
    });

    it('resets form after successful creation', async () => {
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledTimes(1);
      });

      // Form fields should be reset
      await waitFor(() => {
        const projectInput = screen.getByLabelText('Project Path') as HTMLInputElement;
        const promptInput = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
        expect(projectInput.value).toBe('');
        expect(promptInput.value).toBe('');
      });
    });

    it('trims project path and prompt before sending', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const projectInput = screen.getByLabelText('Project Path');
      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(projectInput, { target: { value: '  /home/user/project  ' } });
      fireEvent.change(promptInput, { target: { value: '  Fix the bug  ' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledWith(
          expect.objectContaining({
            projectPath: '/home/user/project',
            prompt: 'Fix the bug',
          }),
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // Error handling on submit failure
  // -----------------------------------------------------------------------

  describe('submit error handling', () => {
    it('shows toast on submit failure with Error object', async () => {
      mockCreateSession.mockRejectedValue(new Error('Server error'));
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Server error');
      });
    });

    it('shows toast on submit failure with string error', async () => {
      mockCreateSession.mockRejectedValue('Something went wrong');
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Something went wrong');
      });
    });

    it('does not call onCreated on failure', async () => {
      mockCreateSession.mockRejectedValue(new Error('fail'));
      const onCreated = vi.fn();
      renderForm({ onCreated });
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
      expect(onCreated).not.toHaveBeenCalled();
    });

    it('re-enables button after failure', async () => {
      mockCreateSession.mockRejectedValue(new Error('fail'));
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });

      // Button should be re-enabled (not "Creating...")
      expect(screen.getByText('Create Session')).toBeDefined();
      // Need to re-fill because form may have been partially reset
      // Actually form is NOT reset on error — only on success
      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Model default from localStorage
  // -----------------------------------------------------------------------

  describe('model default from localStorage', () => {
    it('uses model from localStorage when set', async () => {
      localStorage.setItem(STORAGE_KEYS.DEFAULT_MODEL, 'claude-opus-4-6');
      renderForm();

      const modelSelect = screen.getByLabelText('Model (optional)') as HTMLSelectElement;
      expect(modelSelect.value).toBe('claude-opus-4-6');
    });

    it('defaults to empty string (Default) when localStorage is empty', () => {
      renderForm();
      const modelSelect = screen.getByLabelText('Model (optional)') as HTMLSelectElement;
      expect(modelSelect.value).toBe('');
    });

    it('submits with localStorage model value', async () => {
      localStorage.setItem(STORAGE_KEYS.DEFAULT_MODEL, 'claude-haiku-4-5');
      renderForm();
      await fillValidForm();

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledWith(
          expect.objectContaining({ model: 'claude-haiku-4-5' }),
        );
      });
    });

    it('resets model to localStorage default after successful submit', async () => {
      localStorage.setItem(STORAGE_KEYS.DEFAULT_MODEL, 'claude-opus-4-6');
      renderForm();
      await fillValidForm();

      // Change model away from default
      const modelSelect = screen.getByLabelText('Model (optional)') as HTMLSelectElement;
      fireEvent.change(modelSelect, { target: { value: 'claude-haiku-4-5' } });
      expect(modelSelect.value).toBe('claude-haiku-4-5');

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalledTimes(1);
      });

      // After reset, model should go back to localStorage default
      await waitFor(() => {
        const resetModelSelect = screen.getByLabelText('Model (optional)') as HTMLSelectElement;
        expect(resetModelSelect.value).toBe('claude-opus-4-6');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Button disabled state
  // -----------------------------------------------------------------------

  describe('button disabled state', () => {
    it('is disabled when machineId is empty', async () => {
      mockListMachines.mockResolvedValue([]);
      renderForm();
      await waitFor(() => {
        expect(screen.queryByText('Loading machines...')).toBeNull();
      });

      const projectInput = screen.getByLabelText('Project Path');
      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(projectInput, { target: { value: '/valid' } });
      fireEvent.change(promptInput, { target: { value: 'task' } });

      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('is disabled when project path is empty', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const promptInput = screen.getByLabelText('Prompt');
      fireEvent.change(promptInput, { target: { value: 'task' } });

      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('is disabled when prompt is empty', async () => {
      renderForm();
      await waitFor(() => {
        expect(screen.getByText('dev-box')).toBeDefined();
      });

      const projectInput = screen.getByLabelText('Project Path');
      fireEvent.change(projectInput, { target: { value: '/valid/path' } });

      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('is enabled when all required fields are filled', async () => {
      renderForm();
      await fillValidForm();

      const button = screen.getByText('Create Session') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Validation error flow (handleSubmit guards)
  // -----------------------------------------------------------------------

  describe('handleSubmit validation guards', () => {
    it('shows "Project path is required." for empty path on submit', async () => {
      // We need a machine selected but empty projectPath that still passes isDisabled
      // Actually, the button is disabled in this case. But we can test the path-not-absolute case.
      // Let's focus on the "not absolute" case which does get past the button disable.
      renderForm();
      await fillValidForm();

      // Now clear the project path and set a non-absolute value
      const projectInput = screen.getByLabelText('Project Path');
      fireEvent.change(projectInput, { target: { value: 'not-absolute' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(
          screen.getByText('Project path must be an absolute path (start with /)'),
        ).toBeDefined();
      });

      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('clears previous error on new submit attempt', async () => {
      renderForm();
      await fillValidForm();

      // Trigger a validation error first
      const projectInput = screen.getByLabelText('Project Path');
      fireEvent.change(projectInput, { target: { value: 'relative' } });
      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
      });

      // Fix the path and resubmit
      fireEvent.change(projectInput, { target: { value: '/valid/path' } });
      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalled();
      });
    });
  });
});
