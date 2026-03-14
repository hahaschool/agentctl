import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Agent, Machine } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMutate = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('@/lib/queries', () => ({
  useUpdateAgent: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/CronBuilder', () => ({
  CronBuilder: () => null,
}));

vi.mock('@/components/RuntimeSelector', () => ({
  RuntimeSelector: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <div data-testid="runtime-selector">
      <button
        type="button"
        data-testid="switch-to-codex"
        onClick={() => onChange('codex')}
        disabled={disabled}
      >
        Switch to Codex
      </button>
      <span data-testid="current-runtime">{value}</span>
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: { children: React.ReactNode; htmlFor?: string }) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode; value: string }) => (
    <div>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GeneralTab } from './GeneralTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'adhoc',
    runtime: 'claude-code',
    status: 'registered',
    schedule: null,
    projectPath: '/home/user/project',
    worktreeBranch: null,
    currentSessionId: null,
    config: {
      mcpOverride: { excluded: ['server-a'], custom: [] },
      skillOverride: { excluded: ['skill-x'], custom: [] },
    },
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    accountId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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

const MACHINES = [makeMachine()];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeneralTab', () => {
  it('renders the general settings form', () => {
    render(<GeneralTab agent={makeAgent()} machines={MACHINES} />);
    expect(screen.getByDisplayValue('test-agent')).toBeDefined();
  });

  it('clears mcpOverride and skillOverride when runtime changes and save is clicked', () => {
    mockMutate.mockClear();
    mockToastSuccess.mockClear();

    render(<GeneralTab agent={makeAgent()} machines={MACHINES} />);

    // Switch runtime from claude-code to codex
    fireEvent.click(screen.getByTestId('switch-to-codex'));

    // The form should be dirty now
    expect(screen.getByText('You have unsaved changes')).toBeDefined();

    // Click save
    fireEvent.click(screen.getByText('Save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockMutate.mock.calls[0][0] as {
      id: string;
      runtime: string;
      config?: Record<string, unknown>;
    };

    // Runtime should be codex
    expect(callArgs.runtime).toBe('codex');

    // Config should have overrides cleared
    expect(callArgs.config).toBeDefined();
    expect(callArgs.config?.mcpOverride).toBeUndefined();
    expect(callArgs.config?.skillOverride).toBeUndefined();
    expect(callArgs.config?.mcpServers).toBeUndefined();
  });

  it('does NOT clear overrides when runtime stays the same', () => {
    mockMutate.mockClear();

    const agent = makeAgent({ name: 'original' });
    const { rerender } = render(<GeneralTab agent={agent} machines={MACHINES} />);

    // Change name to trigger dirty state without changing runtime
    const nameInput = screen.getByDisplayValue('original');
    fireEvent.change(nameInput, { target: { value: 'updated-name' } });

    // Save
    fireEvent.click(screen.getByText('Save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const callArgs = mockMutate.mock.calls[0][0] as {
      id: string;
      name: string;
      runtime: string;
      config?: Record<string, unknown>;
    };

    // Runtime unchanged — config should NOT be included (no overrides cleared)
    expect(callArgs.name).toBe('updated-name');
    expect(callArgs.config).toBeUndefined();
  });
});
