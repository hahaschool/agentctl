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
  skillDiscoverQuery: vi.fn(() => ({
    queryKey: ['skills', 'discover', 'machine-1', 'claude-code'],
    queryFn: () =>
      Promise.resolve({
        ok: true,
        discovered: [
          {
            id: 'tdd',
            name: 'TDD',
            description: 'Test-driven development',
            path: '/home/user/.claude/skills/tdd/SKILL.md',
            source: 'global',
            runtime: 'claude-code',
          },
        ],
        cached: false,
      }),
    enabled: true,
    staleTime: 30_000,
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

import { SkillsTab } from './SkillsTab';

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
      <SkillsTab agent={agent} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillsTab', () => {
  it('renders SkillPicker for managed runtime agents', () => {
    renderTab();
    expect(screen.getByText('Skills')).toBeDefined();
  });

  it('falls back to managed-runtime skill discovery for non-managed runtime agents', () => {
    renderTab(makeAgent({ runtime: 'nanoclaw' as Agent['runtime'] }));
    expect(screen.getByText('Skills')).toBeDefined();
    expect(
      screen.queryByText(
        'Skill discovery is only available for managed runtimes (claude-code, codex).',
      ),
    ).toBeNull();
  });

  it('falls back to managed-runtime skill discovery when runtime is not set', () => {
    renderTab(makeAgent({ runtime: undefined }));
    expect(screen.getByText('Skills')).toBeDefined();
    expect(
      screen.queryByText(
        'Skill discovery is only available for managed runtimes (claude-code, codex).',
      ),
    ).toBeNull();
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

  it('saves skill overrides to agent config', async () => {
    renderTab(
      makeAgent({
        config: {
          skillOverride: {
            excluded: [],
            custom: [],
          },
        },
      }),
    );

    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      expect(screen.getByText('+ Custom Skill')).toBeDefined();
    });

    // Add a custom skill to make form dirty
    fireEvent.click(screen.getByText('+ Custom Skill'));
    const idInput = screen.getByPlaceholderText('e.g. my-skill');
    const pathInput = screen.getByPlaceholderText('e.g. /path/to/SKILL.md');

    fireEvent.change(idInput, { target: { value: 'custom-skill' } });
    fireEvent.change(pathInput, { target: { value: '/skills/custom/SKILL.md' } });
    fireEvent.click(screen.getByText('Add'));

    // Save
    const saveBtn = screen.getByText('Save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveBtn);

    expect(mockMutate).toHaveBeenCalled();
    const callArgs = mockMutate.mock.calls[0][0] as { id: string; config: Record<string, unknown> };
    expect(callArgs.id).toBe('agent-1');
    expect(callArgs.config.skillOverride).toBeDefined();
  });
});
