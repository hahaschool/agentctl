import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMutate = vi.fn();

vi.mock('@/lib/queries', () => ({
  useUpdateAgent: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  mcpDiscoverQuery: vi.fn(() => ({
    queryKey: ['mcp', 'discover', 'machine-1', 'claude-code'],
    queryFn: () =>
      Promise.resolve({
        discovered: [
          {
            name: 'filesystem',
            config: { command: 'npx', args: ['-y', '@mcp/filesystem'] },
            source: 'global',
          },
        ],
        sources: [],
      }),
    enabled: true,
    staleTime: 30_000,
  })),
  mcpTemplatesQuery: vi.fn(() => ({
    queryKey: ['mcp', 'templates'],
    queryFn: () => Promise.resolve({ ok: true, templates: [], count: 0 }),
    staleTime: 300_000,
  })),
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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="badge">{children}</span>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { McpServersTab } from './McpServersTab';

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
      <McpServersTab agent={agent} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpServersTab', () => {
  it('renders McpServerPicker instead of manual form for managed runtime', () => {
    renderTab();
    // Should show picker's "MCP Servers" expand button, not a manual form
    expect(screen.getByText('MCP Servers')).toBeDefined();
    // The old "Add MCP Server" button should NOT be present
    expect(screen.queryByText('+ Add MCP Server')).toBeNull();
  });

  it('shows message for non-managed runtime agents', () => {
    renderTab(makeAgent({ runtime: 'nanoclaw' as Agent['runtime'] }));
    expect(
      screen.getByText(
        'MCP discovery is only available for managed runtimes (claude-code, codex).',
      ),
    ).toBeDefined();
  });

  it('shows message when runtime is not set', () => {
    renderTab(makeAgent({ runtime: undefined }));
    expect(
      screen.getByText(
        'MCP discovery is only available for managed runtimes (claude-code, codex).',
      ),
    ).toBeDefined();
  });

  it('renders save button', () => {
    renderTab();
    expect(screen.getByText('Save')).toBeDefined();
  });

  it('save button is disabled when no changes made', () => {
    renderTab();
    const saveBtn = screen.getByText('Save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('migrates legacy mcpServers to mcpOverride on load', () => {
    const agent = makeAgent({
      config: {
        mcpServers: {
          'my-server': { command: 'node', args: ['server.js'] },
        },
      },
    });
    renderTab(agent);
    // Should show the picker, meaning migration happened without error
    expect(screen.getByText('MCP Servers')).toBeDefined();
  });

  it('saves mcpOverride changes to agent config', async () => {
    renderTab(
      makeAgent({
        config: {
          mcpOverride: {
            excluded: ['something'],
            custom: [],
          },
        },
      }),
    );

    // Expand picker to see the servers
    fireEvent.click(screen.getByText('MCP Servers'));

    // The save button should initially be disabled (no changes)
    // We need to trigger a change. Click "+ Custom Server", add one.
    await vi.waitFor(() => {
      expect(screen.getByText('+ Custom Server')).toBeDefined();
    });

    fireEvent.click(screen.getByText('+ Custom Server'));
    const nameInput = screen.getByPlaceholderText('e.g. my-server');
    const cmdInput = screen.getByPlaceholderText('e.g. npx');

    fireEvent.change(nameInput, { target: { value: 'new-srv' } });
    fireEvent.change(cmdInput, { target: { value: 'echo' } });
    fireEvent.click(screen.getByText('Add'));

    // Now save should be enabled
    const saveBtn = screen.getByText('Save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    // Click save
    fireEvent.click(saveBtn);

    expect(mockMutate).toHaveBeenCalled();
    const callArgs = mockMutate.mock.calls[0][0] as { id: string; config: Record<string, unknown> };
    expect(callArgs.id).toBe('agent-1');
    expect(callArgs.config.mcpOverride).toBeDefined();
    // Legacy field should be removed
    expect(callArgs.config.mcpServers).toBeUndefined();
  });
});
