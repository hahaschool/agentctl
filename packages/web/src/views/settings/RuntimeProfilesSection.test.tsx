import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAccountsQuery,
  mockMachinesQuery,
  mockRuntimeConfigDefaultsQuery,
  mockUpdateRuntimeDefaults,
  mockToast,
} = vi.hoisted(() => ({
  mockAccountsQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockRuntimeConfigDefaultsQuery: vi.fn(),
  mockUpdateRuntimeDefaults: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span {...props}>{children as React.ReactNode}</span>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/lib/queries', () => ({
  accountsQuery: () => mockAccountsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  runtimeConfigDefaultsQuery: () => mockRuntimeConfigDefaultsQuery(),
  useUpdateRuntimeConfigDefaults: () => mockUpdateRuntimeDefaults(),
}));

import { RuntimeProfilesSection } from './RuntimeProfilesSection';

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RuntimeProfilesSection />
    </QueryClientProvider>,
  );
}

describe('RuntimeProfilesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue([
        { id: 'acc-1', provider: 'anthropic_api', isActive: true },
        { id: 'acc-2', provider: 'openai_api', isActive: true },
      ]),
      initialData: [
        { id: 'acc-1', provider: 'anthropic_api', isActive: true },
        { id: 'acc-2', provider: 'openai_api', isActive: true },
      ],
    });
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        { id: 'machine-1', hostname: 'alpha', status: 'online' },
        { id: 'machine-2', hostname: 'beta', status: 'online' },
      ]),
      initialData: [
        { id: 'machine-1', hostname: 'alpha', status: 'online' },
        { id: 'machine-2', hostname: 'beta', status: 'online' },
      ],
    });
    mockRuntimeConfigDefaultsQuery.mockReturnValue({
      queryKey: ['runtime-config', 'defaults'],
      queryFn: vi.fn().mockResolvedValue({
        version: 1,
        hash: 'sha256:test',
        config: {
          version: 1,
          hash: 'sha256:test',
          instructions: { userGlobal: 'a', projectTemplate: 'b' },
          mcpServers: [],
          skills: [],
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          environmentPolicy: { inherit: ['PATH'], set: {} },
          runtimeOverrides: {
            claudeCode: { model: 'claude-sonnet-4-6' },
            codex: { model: 'gpt-5-codex' },
          },
        },
      }),
      initialData: {
        version: 1,
        hash: 'sha256:test',
        config: {
          version: 1,
          hash: 'sha256:test',
          instructions: { userGlobal: 'a', projectTemplate: 'b' },
          mcpServers: [],
          skills: [],
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          environmentPolicy: { inherit: ['PATH'], set: {} },
          runtimeOverrides: {
            claudeCode: { model: 'claude-sonnet-4-6' },
            codex: { model: 'gpt-5-codex' },
          },
        },
      },
    });
    mockUpdateRuntimeDefaults.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it('renders cards for Claude Code and Codex', () => {
    renderSection();
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('renders access strategy and switching controls', () => {
    renderSection();
    expect(screen.getAllByText('Access source strategy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Runtime switching').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failover only').length).toBeGreaterThan(0);
  });

  it('renders the save action', () => {
    renderSection();
    expect(screen.getByText('Save runtime profiles')).toBeDefined();
  });
});
