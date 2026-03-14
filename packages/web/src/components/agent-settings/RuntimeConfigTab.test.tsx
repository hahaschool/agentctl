import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/queries', () => ({
  useUpdateAgent: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    toast: vi.fn(),
  }),
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

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="label">{children}</span>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select">{children}</div>
  ),
  SelectTrigger: ({
    children,
    id,
  }: {
    children: React.ReactNode;
    id?: string;
    className?: string;
  }) => (
    <button type="button" data-testid={`select-trigger-${id ?? 'unknown'}`}>
      {children}
    </button>
  ),
  SelectValue: () => <span data-testid="select-value" />,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { RuntimeConfigTab } from './RuntimeConfigTab';

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
    config: {},
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    accountId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderTab(agent: Agent = makeAgent()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <RuntimeConfigTab agent={agent} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuntimeConfigTab', () => {
  it('renders sandbox and approval fields for claude-code runtime', () => {
    renderTab(makeAgent({ runtime: 'claude-code' }));
    expect(screen.getByText('Sandbox Level')).toBeDefined();
    expect(screen.getByText('Approval Policy')).toBeDefined();
    // Codex-only fields should not be present
    expect(screen.queryByText('Reasoning Effort')).toBeNull();
    expect(screen.queryByText('Model Provider')).toBeNull();
  });

  it('renders all 4 fields for codex runtime', () => {
    renderTab(makeAgent({ runtime: 'codex' }));
    expect(screen.getByText('Sandbox Level')).toBeDefined();
    expect(screen.getByText('Approval Policy')).toBeDefined();
    expect(screen.getByText('Reasoning Effort')).toBeDefined();
    expect(screen.getByText('Model Provider')).toBeDefined();
  });

  it('shows message for unmanaged runtime', () => {
    renderTab(makeAgent({ runtime: 'nanoclaw' as Agent['runtime'] }));
    expect(
      screen.getByText(
        'Runtime config is only available for managed runtimes (claude-code, codex).',
      ),
    ).toBeDefined();
  });

  it('shows message when runtime is not set', () => {
    renderTab(makeAgent({ runtime: undefined }));
    expect(
      screen.getByText(
        'Runtime config is only available for managed runtimes (claude-code, codex).',
      ),
    ).toBeDefined();
  });

  it('renders save button', () => {
    renderTab();
    expect(screen.getByText('Save')).toBeDefined();
  });

  it('save button is disabled when no changes', () => {
    renderTab();
    const saveBtn = screen.getByText('Save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
