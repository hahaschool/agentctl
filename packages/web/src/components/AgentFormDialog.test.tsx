import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/api', () => ({
  api: {},
}));

vi.mock('../lib/queries', () => ({}));

vi.mock('./Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
  ToastContainer: () => null,
}));

// Mock lucide-react icons used by UI sub-components
vi.mock('lucide-react', () => ({
  XIcon: (props: Record<string, unknown>) => <svg data-testid="icon-x" {...props} />,
  CheckIcon: (props: Record<string, unknown>) => <svg data-testid="icon-check" {...props} />,
  ChevronDownIcon: (props: Record<string, unknown>) => (
    <svg data-testid="icon-chevron-down" {...props} />
  ),
  ChevronUpIcon: (props: Record<string, unknown>) => (
    <svg data-testid="icon-chevron-up" {...props} />
  ),
}));

// Mock Radix Select using a data-attribute callback pattern.
// Each Select stores its onValueChange in a data attribute on a hidden element,
// and SelectItem finds its parent Select to call the correct handler.
let selectIdCounter = 0;
const selectCallbacks = new Map<string, (v: string) => void>();

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => {
    const id = `mock-select-${selectIdCounter++}`;
    if (onValueChange) selectCallbacks.set(id, onValueChange);
    return (
      <div data-testid="mock-select" data-select-id={id} data-value={value} data-disabled={String(!!disabled)}>
        {children}
      </div>
    );
  },
  SelectTrigger: ({
    children,
    id,
  }: {
    children: React.ReactNode;
    id?: string;
    className?: string;
  }) => (
    <span data-testid={`select-trigger${id ? `-${id}` : ''}`}>{children}</span>
  ),
  SelectValue: ({ placeholder, children }: { placeholder?: string; children?: React.ReactNode }) => (
    <span data-testid="select-value">{children ?? placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => (
    <div
      data-testid={`select-item-${value}`}
      role="option"
      data-value={value}
      onClick={(e: React.MouseEvent) => {
        // Walk up the DOM to find the parent mock-select and call its callback
        let el = (e.target as HTMLElement).parentElement;
        while (el) {
          const selectId = el.getAttribute('data-select-id');
          if (selectId && selectCallbacks.has(selectId)) {
            selectCallbacks.get(selectId)!(value);
            return;
          }
          el = el.parentElement;
        }
      }}
    >
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open !== false ? <div data-testid="mock-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: string;
    variant?: string;
    size?: string;
    className?: string;
  }) => (
    <button type={type === 'submit' ? 'submit' : 'button'} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import type { Agent, Machine } from '../lib/api';
import { DEFAULT_MODEL } from '../lib/model-options';
import { STORAGE_KEYS } from '../lib/storage-keys';
import {
  AgentFormDialog,
  type AgentFormCreateData,
  type AgentFormDialogProps,
  type AgentFormEditData,
} from './AgentFormDialog';

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

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-123',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'adhoc',
    status: 'idle',
    schedule: null,
    projectPath: '/home/user/project',
    worktreeBranch: null,
    currentSessionId: null,
    config: {
      model: 'claude-sonnet-4-6',
      initialPrompt: 'Fix all the bugs',
      maxTurns: 10,
      permissionMode: 'acceptEdits',
      systemPrompt: 'You are a helpful assistant',
    },
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    accountId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const MACHINES = [
  makeMachine({ id: 'machine-1', hostname: 'dev-box', status: 'online' }),
  makeMachine({ id: 'machine-2', hostname: 'staging-box', status: 'offline' }),
];

const RECENT_PATHS = ['/home/user/project-a', '/home/user/project-b', '/opt/code/service'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(overrides: Partial<AgentFormDialogProps> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSubmit = overrides.onSubmit ?? vi.fn();

  const props: AgentFormDialogProps = {
    mode: 'create',
    open: true,
    onClose,
    onSubmit,
    isPending: false,
    agent: null,
    machines: MACHINES,
    recentProjectPaths: RECENT_PATHS,
    ...overrides,
  };

  const result = render(<AgentFormDialog {...props} />);
  return { ...result, onClose, onSubmit, props };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  selectIdCounter = 0;
  selectCallbacks.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('AgentFormDialog', () => {
  // -----------------------------------------------------------------------
  // 1. Create mode rendering
  // -----------------------------------------------------------------------

  describe('create mode rendering', () => {
    it('renders "New Task" dialog title in create mode', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('New Task')).toBeDefined();
    });

    it('renders prompt textarea with correct placeholder', () => {
      renderDialog({ mode: 'create' });
      const textarea = screen.getByLabelText('Agent prompt');
      expect(textarea).toBeDefined();
      expect((textarea as HTMLTextAreaElement).placeholder).toBe(
        'What do you want the agent to do?',
      );
    });

    it('renders project path input', () => {
      renderDialog({ mode: 'create' });
      const label = screen.getByText('Project');
      expect(label).toBeDefined();
    });

    it('renders "Start Agent" submit button', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('Start Agent')).toBeDefined();
    });

    it('renders Cancel button', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('Cancel')).toBeDefined();
    });

    it('shows "Starting..." text when isPending is true', () => {
      renderDialog({ mode: 'create', isPending: true });
      expect(screen.getByText('Starting...')).toBeDefined();
    });

    it('renders nothing when open is false', () => {
      const { container } = renderDialog({ mode: 'create', open: false });
      expect(container.textContent).toBe('');
    });

    it('shows "Advanced" toggle button', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('Advanced')).toBeDefined();
    });

    it('shows hint text about Enter and Shift+Enter', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText(/Press Enter to start/)).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Edit mode rendering — pre-populates fields
  // -----------------------------------------------------------------------

  describe('edit mode rendering', () => {
    it('renders "Edit Agent" dialog title in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      expect(screen.getByText('Edit Agent')).toBeDefined();
    });

    it('pre-populates name field from agent', () => {
      renderDialog({ mode: 'edit', agent: makeAgent({ name: 'my-cool-agent' }) });
      const nameInput = screen.getByDisplayValue('my-cool-agent') as HTMLInputElement;
      expect(nameInput).toBeDefined();
    });

    it('pre-populates initial prompt from agent config', () => {
      const agent = makeAgent({ config: { initialPrompt: 'Do something cool' } });
      renderDialog({ mode: 'edit', agent });
      const promptTextarea = screen.getByDisplayValue('Do something cool') as HTMLTextAreaElement;
      expect(promptTextarea).toBeDefined();
    });

    it('pre-populates model from agent config', () => {
      const agent = makeAgent({ config: { model: 'claude-opus-4-6' } });
      renderDialog({ mode: 'edit', agent });
      const modelInput = screen.getByDisplayValue('claude-opus-4-6') as HTMLInputElement;
      expect(modelInput).toBeDefined();
    });

    it('pre-populates maxTurns from agent config', () => {
      const agent = makeAgent({ config: { maxTurns: 25 } });
      renderDialog({ mode: 'edit', agent });
      const maxTurnsInput = screen.getByDisplayValue('25') as HTMLInputElement;
      expect(maxTurnsInput).toBeDefined();
    });

    it('pre-populates systemPrompt from agent config', () => {
      const agent = makeAgent({ config: { systemPrompt: 'Be thorough' } });
      renderDialog({ mode: 'edit', agent });
      const sysprompt = screen.getByDisplayValue('Be thorough') as HTMLTextAreaElement;
      expect(sysprompt).toBeDefined();
    });

    it('pre-populates schedule from agent', () => {
      const agent = makeAgent({ type: 'cron', schedule: '0 */6 * * *' });
      renderDialog({ mode: 'edit', agent });
      const scheduleInput = screen.getByDisplayValue('0 */6 * * *') as HTMLInputElement;
      expect(scheduleInput).toBeDefined();
    });

    it('shows "Save Changes" button in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      expect(screen.getByText('Save Changes')).toBeDefined();
    });

    it('shows "Saving..." when isPending in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent(), isPending: true });
      expect(screen.getByText('Saving...')).toBeDefined();
    });

    it('shows required asterisk on name field in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      // The label contains "Name" and a "*" span
      const asterisks = screen.getAllByText('*');
      expect(asterisks.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Name auto-generation from prompt
  // -----------------------------------------------------------------------

  describe('name auto-generation from prompt', () => {
    it('shows auto-generated slug as placeholder in name field', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));

      const promptTextarea = screen.getByLabelText('Agent prompt');
      fireEvent.change(promptTextarea, { target: { value: 'Fix the auth bug in login' } });

      const nameInput = screen.getByPlaceholderText('fix-the-auth-bug-in-login');
      expect(nameInput).toBeDefined();
    });

    it('shows "auto-generated from prompt" placeholder when no prompt is typed', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));

      const nameInput = screen.getByPlaceholderText('auto-generated from prompt');
      expect(nameInput).toBeDefined();
    });

    it('uses slugified prompt as name when name field is left blank on submit', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const promptTextarea = screen.getByLabelText('Agent prompt');
      fireEvent.change(promptTextarea, { target: { value: 'Fix the auth bug!' } });

      fireEvent.click(screen.getByText('Start Agent'));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.name).toBe('fix-the-auth-bug');
    });

    it('uses user-specified name over auto-generated when provided', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      // Open advanced first, then type prompt so name placeholder updates
      fireEvent.click(screen.getByText('Advanced'));

      const promptTextarea = screen.getByLabelText('Agent prompt');
      fireEvent.change(promptTextarea, { target: { value: 'Fix the auth bug' } });

      // Now find name input by its id
      const nameInput = document.getElementById('create-task-name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'custom-name' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.name).toBe('custom-name');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Machine dropdown
  // -----------------------------------------------------------------------

  describe('machine dropdown', () => {
    it('renders machine label', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('Machine')).toBeDefined();
    });

    it('auto-selects first online machine in create mode (verified via submission)', () => {
      const onSubmit = vi.fn();
      const machines = [
        makeMachine({ id: 'machine-off', hostname: 'offline-1', status: 'offline' }),
        makeMachine({ id: 'machine-on', hostname: 'online-1', status: 'online' }),
      ];
      renderDialog({ mode: 'create', machines, onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.machineId).toBe('machine-on');
    });

    it('falls back to first machine when none are online (verified via submission)', () => {
      const onSubmit = vi.fn();
      const machines = [
        makeMachine({ id: 'machine-off-1', hostname: 'box-1', status: 'offline' }),
        makeMachine({ id: 'machine-off-2', hostname: 'box-2', status: 'offline' }),
      ];
      renderDialog({ mode: 'create', machines, onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.machineId).toBe('machine-off-1');
    });

    it('uses last-used machine from localStorage if available (verified via submission)', () => {
      localStorage.setItem(STORAGE_KEYS.LAST_MACHINE_ID, 'machine-2');
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.machineId).toBe('machine-2');
    });

    it('renders machine hostnames in the select items', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('dev-box')).toBeDefined();
      expect(screen.getByText('staging-box')).toBeDefined();
    });

    it('shows machine IDs alongside hostnames in create mode', () => {
      renderDialog({ mode: 'create' });
      expect(screen.getByText('(machine-1)')).toBeDefined();
      expect(screen.getByText('(machine-2)')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Type selector
  // -----------------------------------------------------------------------

  describe('type selector', () => {
    it('shows type selector in advanced section for create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Type')).toBeDefined();
    });

    it('renders Ad-hoc type option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Ad-hoc')).toBeDefined();
    });

    it('renders Manual type option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Manual')).toBeDefined();
    });

    it('renders Loop type option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Loop')).toBeDefined();
    });

    it('renders Heartbeat type option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Heartbeat')).toBeDefined();
    });

    it('renders Cron type option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Cron')).toBeDefined();
    });

    it('shows type select in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      expect(screen.getByText('Type')).toBeDefined();
    });

    it('changes type when a type option is clicked', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });
      fireEvent.click(screen.getByText('Advanced'));

      // Click the "Loop" type item
      fireEvent.click(screen.getByTestId('select-item-loop'));

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.type).toBe('loop');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Model selector
  // -----------------------------------------------------------------------

  describe('model selector', () => {
    it('shows model select in advanced section for create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Model')).toBeDefined();
    });

    it('model is initially empty on fresh create render', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      // useState('') initializes model to empty; it is only set to DEFAULT_MODEL
      // inside resetCreateForm which runs on dialog close, not on initial mount.
      // Therefore config.model is undefined (empty string is omitted).
      const hasModel = data.config !== undefined && 'model' in (data.config ?? {});
      expect(hasModel).toBe(false);
    });

    it('shows custom model input when model does not match known options', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      // model is '' which is not in MODEL_OPTIONS, so custom model input shows
      expect(screen.getByPlaceholderText('Enter custom model ID')).toBeDefined();
    });

    it('shows model as plain input in edit mode', () => {
      const agent = makeAgent({ config: { model: 'claude-opus-4-6' } });
      renderDialog({ mode: 'edit', agent });
      const modelInput = screen.getByDisplayValue('claude-opus-4-6') as HTMLInputElement;
      expect(modelInput.tagName).toBe('INPUT');
    });

    it('renders "Custom model ID..." option in create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Custom model ID...')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Advanced options toggle
  // -----------------------------------------------------------------------

  describe('advanced options toggle', () => {
    it('advanced section is collapsed by default', () => {
      renderDialog({ mode: 'create' });
      expect(screen.queryByText('Max Turns')).toBeNull();
      expect(screen.queryByText('System Prompt')).toBeNull();
    });

    it('expands advanced section on click', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('Max Turns')).toBeDefined();
      expect(screen.getByText('Permission Mode')).toBeDefined();
      expect(screen.getByText('System Prompt')).toBeDefined();
      expect(screen.getByText('Model')).toBeDefined();
      expect(screen.getByText('Type')).toBeDefined();
    });

    it('collapses advanced section on second click', () => {
      renderDialog({ mode: 'create' });
      const toggle = screen.getByText('Advanced');

      fireEvent.click(toggle);
      expect(screen.getByText('Max Turns')).toBeDefined();

      fireEvent.click(toggle);
      expect(screen.queryByText('Max Turns')).toBeNull();
    });

    it('shows "(customized)" badge when name is set', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));

      const nameInput = screen.getByPlaceholderText('auto-generated from prompt');
      fireEvent.change(nameInput, { target: { value: 'my-agent' } });

      expect(screen.getByText('(customized)')).toBeDefined();
    });

    it('shows "(customized)" badge when system prompt is set', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));

      const sysPrompt = screen.getByPlaceholderText('Custom system instructions...');
      fireEvent.change(sysPrompt, { target: { value: 'Be careful' } });

      expect(screen.getByText('(customized)')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Schedule field (only visible for cron type)
  // -----------------------------------------------------------------------

  describe('schedule field', () => {
    it('does not show schedule field for adhoc type', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.queryByPlaceholderText('0 */6 * * *')).toBeNull();
    });

    it('shows schedule field when type is cron in edit mode', () => {
      const agent = makeAgent({ type: 'cron', schedule: '*/30 * * * *' });
      renderDialog({ mode: 'edit', agent });
      const scheduleInput = screen.getByDisplayValue('*/30 * * * *');
      expect(scheduleInput).toBeDefined();
    });

    it('shows schedule cron examples as hint text', () => {
      const agent = makeAgent({ type: 'cron' });
      renderDialog({ mode: 'edit', agent });
      expect(screen.getByText(/Cron expression/)).toBeDefined();
    });

    it('shows schedule field after changing type to cron in create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));

      // Change type to cron
      fireEvent.click(screen.getByTestId('select-item-cron'));

      const scheduleInput = screen.getByPlaceholderText('0 */6 * * *');
      expect(scheduleInput).toBeDefined();
    });

    it('includes schedule in create submission when type is cron', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const promptTextarea = screen.getByLabelText('Agent prompt');
      fireEvent.change(promptTextarea, { target: { value: 'Run daily checks' } });

      fireEvent.click(screen.getByText('Advanced'));

      // Change type to cron
      fireEvent.click(screen.getByTestId('select-item-cron'));

      // Set schedule
      const scheduleInput = screen.getByPlaceholderText('0 */6 * * *');
      fireEvent.change(scheduleInput, { target: { value: '0 9 * * *' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.schedule).toBe('0 9 * * *');
      expect(data.type).toBe('cron');
    });
  });

  // -----------------------------------------------------------------------
  // 9. MaxTurns field
  // -----------------------------------------------------------------------

  describe('maxTurns field', () => {
    it('shows max turns in advanced section for create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Max Turns')).toBeDefined();
    });

    it('shows max turns directly in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      expect(screen.getByText('Max Turns')).toBeDefined();
    });

    it('has type=number attribute', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      const input = screen.getByPlaceholderText('unlimited') as HTMLInputElement;
      expect(input.type).toBe('number');
    });

    it('includes maxTurns in config when set', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Do something' } });

      fireEvent.click(screen.getByText('Advanced'));
      const maxTurnsInput = screen.getByPlaceholderText('unlimited');
      fireEvent.change(maxTurnsInput, { target: { value: '15' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.maxTurns).toBe(15);
    });

    it('shows help text about unlimited', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText(/Leave empty for unlimited/)).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 10. Permission mode selector
  // -----------------------------------------------------------------------

  describe('permission mode selector', () => {
    it('shows permission mode in advanced section for create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Permission Mode')).toBeDefined();
    });

    it('shows permission mode in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      expect(screen.getByText('Permission Mode')).toBeDefined();
    });

    it('renders Default permission option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Default')).toBeDefined();
    });

    it('renders Accept Edits permission option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Accept Edits')).toBeDefined();
    });

    it('renders Plan Only permission option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Plan Only')).toBeDefined();
    });

    it('renders Bypass Permissions option', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Bypass Permissions')).toBeDefined();
    });

    it('does not include permissionMode in config when set to default', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.permissionMode).toBeUndefined();
    });

    it('includes permissionMode in config when set to non-default', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      fireEvent.click(screen.getByText('Advanced'));

      // Change permission mode to acceptEdits
      fireEvent.click(screen.getByTestId('select-item-acceptEdits'));

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.permissionMode).toBe('acceptEdits');
    });
  });

  // -----------------------------------------------------------------------
  // 11. System prompt textarea
  // -----------------------------------------------------------------------

  describe('system prompt textarea', () => {
    it('shows system prompt in advanced section for create mode', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByPlaceholderText('Custom system instructions...')).toBeDefined();
    });

    it('shows system prompt directly in edit mode', () => {
      renderDialog({ mode: 'edit', agent: makeAgent() });
      expect(screen.getByPlaceholderText('Custom system instructions...')).toBeDefined();
    });

    it('includes systemPrompt in config when set', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Advanced'));
      const sysPrompt = screen.getByPlaceholderText('Custom system instructions...');
      fireEvent.change(sysPrompt, { target: { value: 'Be careful with files' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.systemPrompt).toBe('Be careful with files');
    });

    it('shows help text about custom instructions', () => {
      renderDialog({ mode: 'create' });
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText(/Custom system instructions appended/)).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 12. Form validation (required fields)
  // -----------------------------------------------------------------------

  describe('form validation', () => {
    it('disables submit when prompt is empty in create mode', () => {
      renderDialog({ mode: 'create' });
      const btn = screen.getByText('Start Agent') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('disables submit when machineId is empty in create mode', () => {
      renderDialog({ mode: 'create', machines: [] });
      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Do something' } });

      const btn = screen.getByText('Start Agent') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('enables submit when prompt and machine are provided', () => {
      renderDialog({ mode: 'create' });
      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Do something' } });

      const btn = screen.getByText('Start Agent') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('disables submit when name is empty in edit mode', () => {
      const agent = makeAgent({ name: '' });
      renderDialog({ mode: 'edit', agent });

      const btn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('disables submit when isPending is true', () => {
      renderDialog({ mode: 'create', isPending: true });
      const btn = screen.getByText('Starting...') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('does not call onSubmit when prompt is whitespace-only', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: '   ' } });

      const btn = screen.getByText('Start Agent') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);

      fireEvent.click(btn);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 13. Create submission
  // -----------------------------------------------------------------------

  describe('create submission', () => {
    it('calls onSubmit with correct AgentFormCreateData', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Fix the login bug' } });

      fireEvent.click(screen.getByText('Start Agent'));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.name).toBe('fix-the-login-bug');
      expect(data.machineId).toBe('machine-1');
      expect(data.type).toBe('adhoc');
      expect(data.config?.initialPrompt).toBe('Fix the login bug');
    });

    it('includes model in config when a model is selected', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      // Open advanced and type a custom model
      fireEvent.click(screen.getByText('Advanced'));
      const customModelInput = screen.getByPlaceholderText('Enter custom model ID');
      fireEvent.change(customModelInput, { target: { value: 'claude-opus-4-6' } });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.model).toBe('claude-opus-4-6');
    });

    it('includes projectPath when provided', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      const projectInput = screen.getByPlaceholderText('Select or type a project path...');
      fireEvent.change(projectInput, { target: { value: '/home/user/my-project' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.projectPath).toBe('/home/user/my-project');
    });

    it('omits projectPath when empty', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.projectPath).toBeUndefined();
    });

    it('trims prompt before sending', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: '  Fix the bug  ' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.initialPrompt).toBe('Fix the bug');
    });

    it('saves last-used machineId to localStorage on submit', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      expect(localStorage.getItem(STORAGE_KEYS.LAST_MACHINE_ID)).toBe('machine-1');
    });

    it('submits via Enter key press on prompt textarea', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: false });

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('does not submit on Shift+Enter (newline)', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });
      fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: true });

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 14. Edit/update submission
  // -----------------------------------------------------------------------

  describe('edit submission', () => {
    it('calls onSubmit with correct AgentFormEditData', () => {
      const onSubmit = vi.fn();
      const agent = makeAgent({
        id: 'agent-abc',
        name: 'original-agent',
        machineId: 'machine-1',
        type: 'manual',
        config: { model: 'claude-opus-4-6', initialPrompt: 'Old prompt' },
      });
      renderDialog({ mode: 'edit', agent, onSubmit });

      fireEvent.click(screen.getByText('Save Changes'));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const data = onSubmit.mock.calls[0]?.[0] as AgentFormEditData;
      expect(data.id).toBe('agent-abc');
      expect(data.name).toBe('original-agent');
      expect(data.machineId).toBe('machine-1');
      expect(data.type).toBe('manual');
    });

    it('sends schedule as null for non-cron types', () => {
      const onSubmit = vi.fn();
      const agent = makeAgent({ type: 'adhoc' });
      renderDialog({ mode: 'edit', agent, onSubmit });

      fireEvent.click(screen.getByText('Save Changes'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormEditData;
      expect(data.schedule).toBeNull();
    });

    it('does not submit when agent is null in edit mode', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'edit', agent: null, onSubmit });

      const btn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('trims name before sending in edit mode', () => {
      const onSubmit = vi.fn();
      const agent = makeAgent({ name: 'test-agent' });
      renderDialog({ mode: 'edit', agent, onSubmit });

      const nameInput = screen.getByDisplayValue('test-agent');
      fireEvent.change(nameInput, { target: { value: '  trimmed-name  ' } });

      fireEvent.click(screen.getByText('Save Changes'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormEditData;
      expect(data.name).toBe('trimmed-name');
    });

    it('updates config fields on edit submission', () => {
      const onSubmit = vi.fn();
      const agent = makeAgent({ config: {} });
      renderDialog({ mode: 'edit', agent, onSubmit });

      const modelInput = screen.getByPlaceholderText('claude-sonnet-4-6');
      fireEvent.change(modelInput, { target: { value: 'custom-model' } });

      const promptTextarea = screen.getByPlaceholderText(
        'Describe what this agent should do...',
      );
      fireEvent.change(promptTextarea, { target: { value: 'New prompt' } });

      fireEvent.click(screen.getByText('Save Changes'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormEditData;
      expect(data.config?.model).toBe('custom-model');
      expect(data.config?.initialPrompt).toBe('New prompt');
    });

    it('removes model from config when cleared in edit mode', () => {
      const onSubmit = vi.fn();
      const agent = makeAgent({ config: { model: 'claude-opus-4-6' } });
      renderDialog({ mode: 'edit', agent, onSubmit });

      const modelInput = screen.getByDisplayValue('claude-opus-4-6');
      fireEvent.change(modelInput, { target: { value: '' } });

      fireEvent.click(screen.getByText('Save Changes'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormEditData;
      expect(data.config?.model).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 15. Cancel/close behavior
  // -----------------------------------------------------------------------

  describe('cancel and close behavior', () => {
    it('calls onClose when Cancel is clicked in create mode', () => {
      const onClose = vi.fn();
      renderDialog({ mode: 'create', onClose });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Cancel is clicked in edit mode', () => {
      const onClose = vi.fn();
      renderDialog({ mode: 'edit', agent: makeAgent(), onClose });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Note: Radix DialogContent renders a built-in close button with sr-only "Close" label,
    // but we mock Dialog as a simple div, so that button doesn't exist in tests.
  });

  // -----------------------------------------------------------------------
  // 16. Project path search with dropdown
  // -----------------------------------------------------------------------

  describe('project path search with dropdown', () => {
    it('shows dropdown with recent paths on focus', () => {
      renderDialog({ mode: 'create' });
      const projectInput = screen.getByPlaceholderText('Select or type a project path...');
      fireEvent.focus(projectInput);

      expect(screen.getByText('/home/user/project-a')).toBeDefined();
      expect(screen.getByText('/home/user/project-b')).toBeDefined();
      expect(screen.getByText('/opt/code/service')).toBeDefined();
    });

    it('does not show dropdown when there are no recent paths', () => {
      renderDialog({ mode: 'create', recentProjectPaths: [] });
      const projectInput = screen.getByPlaceholderText('/path/to/project');
      fireEvent.focus(projectInput);

      expect(screen.queryByTitle('/home/user/project-a')).toBeNull();
    });

    it('filters paths based on search input', () => {
      renderDialog({ mode: 'create' });
      const projectInput = screen.getByPlaceholderText('Select or type a project path...');

      fireEvent.change(projectInput, { target: { value: 'service' } });

      expect(screen.getByTitle('/opt/code/service')).toBeDefined();
      expect(screen.queryByTitle('/home/user/project-a')).toBeNull();
    });

    it('selects a path from dropdown on click', () => {
      renderDialog({ mode: 'create' });
      const projectInput = screen.getByPlaceholderText(
        'Select or type a project path...',
      ) as HTMLInputElement;
      fireEvent.focus(projectInput);

      const item = screen.getByTitle('/home/user/project-a');
      fireEvent.click(item);

      expect(projectInput.value).toBe('/home/user/project-a');
    });

    it('closes dropdown after selecting a path', () => {
      renderDialog({ mode: 'create' });
      const projectInput = screen.getByPlaceholderText('Select or type a project path...');
      fireEvent.focus(projectInput);

      const item = screen.getByTitle('/home/user/project-a');
      fireEvent.click(item);

      expect(screen.queryByTitle('/home/user/project-b')).toBeNull();
    });

    it('shows short path in dropdown items', () => {
      renderDialog({ mode: 'create' });
      const projectInput = screen.getByPlaceholderText('Select or type a project path...');
      fireEvent.focus(projectInput);

      expect(screen.getByText('~/user/project-a')).toBeDefined();
      expect(screen.getByText('~/code/service')).toBeDefined();
    });

    it('shows correct placeholder based on recent paths availability', () => {
      renderDialog({ mode: 'create', recentProjectPaths: RECENT_PATHS });
      const input = screen.getByPlaceholderText(
        'Select or type a project path...',
      ) as HTMLInputElement;
      expect(input).toBeDefined();
    });

    it('shows fallback placeholder when no recent paths', () => {
      renderDialog({ mode: 'create', recentProjectPaths: [] });
      const input = screen.getByPlaceholderText('/path/to/project') as HTMLInputElement;
      expect(input).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('slugifies prompt to "new-task" when prompt has only special characters', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: '!@#$%^&*()' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.name).toBe('new-task');
    });

    it('truncates long prompt slugs to 40 characters max', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const longPrompt =
        'this is a very long prompt that should be truncated when converted to a slug name for the agent';
      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: longPrompt } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.name.length).toBeLessThanOrEqual(40);
    });

    it('omits empty model from config in create submission', () => {
      localStorage.setItem(STORAGE_KEYS.DEFAULT_MODEL, '');
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Simple task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.config?.initialPrompt).toBe('Simple task');
      expect(data.config?.model).toBeUndefined();
    });

    it('handles agent with empty config in edit mode gracefully', () => {
      const agent = makeAgent({ config: {} });
      renderDialog({ mode: 'edit', agent });

      const modelInput = screen.getByPlaceholderText('claude-sonnet-4-6') as HTMLInputElement;
      expect(modelInput.value).toBe('');

      const promptTextarea = screen.getByPlaceholderText(
        'Describe what this agent should do...',
      ) as HTMLTextAreaElement;
      expect(promptTextarea.value).toBe('');
    });

    it('omits schedule from create data for non-cron types', () => {
      const onSubmit = vi.fn();
      renderDialog({ mode: 'create', onSubmit });

      const prompt = screen.getByLabelText('Agent prompt');
      fireEvent.change(prompt, { target: { value: 'Task' } });

      fireEvent.click(screen.getByText('Start Agent'));

      const data = onSubmit.mock.calls[0]?.[0] as AgentFormCreateData;
      expect(data.schedule).toBeUndefined();
    });

    it('does not submit in edit mode when machineId is missing', () => {
      const onSubmit = vi.fn();
      const agent = makeAgent({ machineId: '' });
      renderDialog({ mode: 'edit', agent, machines: [], onSubmit });

      // Even with a name, it should be disabled because machineId is empty
      const btn = screen.getByText('Save Changes') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
