import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMachinesQuery, mockRuntimeConfigDriftQuery } = vi.hoisted(() => ({
  mockMachinesQuery: vi.fn(),
  mockRuntimeConfigDriftQuery: vi.fn(),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span {...props}>{children as React.ReactNode}</span>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/lib/queries', () => ({
  machinesQuery: () => mockMachinesQuery(),
  runtimeConfigDriftQuery: () => mockRuntimeConfigDriftQuery(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { WorkersSyncSection } from './WorkersSyncSection';

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkersSyncSection />
    </QueryClientProvider>,
  );
}

describe('WorkersSyncSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([{ id: 'machine-1', hostname: 'alpha', status: 'online' }]),
      initialData: [{ id: 'machine-1', hostname: 'alpha', status: 'online' }],
    });
    mockRuntimeConfigDriftQuery.mockReturnValue({
      queryKey: ['runtime-config', 'drift'],
      queryFn: vi.fn().mockResolvedValue({
        activeVersion: 1,
        activeHash: 'sha256:test',
        items: [
          {
            id: 'drift-1',
            machineId: 'machine-1',
            runtime: 'claude-code',
            isInstalled: true,
            isAuthenticated: true,
            syncStatus: 'in-sync',
            configVersion: 1,
            configHash: 'sha256:test',
            metadata: { localCredentialCount: 1, mirroredCredentialCount: 2 },
            lastConfigAppliedAt: '2026-03-10T10:00:00Z',
            createdAt: '2026-03-10T10:00:00Z',
            updatedAt: '2026-03-10T10:00:00Z',
            drifted: false,
          },
          {
            id: 'drift-2',
            machineId: 'machine-1',
            runtime: 'codex',
            isInstalled: true,
            isAuthenticated: false,
            syncStatus: 'drifted',
            configVersion: 1,
            configHash: 'sha256:test',
            metadata: { localCredentialCount: 0, mirroredCredentialCount: 1 },
            lastConfigAppliedAt: '2026-03-10T10:00:00Z',
            createdAt: '2026-03-10T10:00:00Z',
            updatedAt: '2026-03-10T10:00:00Z',
            drifted: true,
          },
        ],
      }),
      initialData: {
        activeVersion: 1,
        activeHash: 'sha256:test',
        items: [
          {
            id: 'drift-1',
            machineId: 'machine-1',
            runtime: 'claude-code',
            isInstalled: true,
            isAuthenticated: true,
            syncStatus: 'in-sync',
            configVersion: 1,
            configHash: 'sha256:test',
            metadata: { localCredentialCount: 1, mirroredCredentialCount: 2 },
            lastConfigAppliedAt: '2026-03-10T10:00:00Z',
            createdAt: '2026-03-10T10:00:00Z',
            updatedAt: '2026-03-10T10:00:00Z',
            drifted: false,
          },
          {
            id: 'drift-2',
            machineId: 'machine-1',
            runtime: 'codex',
            isInstalled: true,
            isAuthenticated: false,
            syncStatus: 'drifted',
            configVersion: 1,
            configHash: 'sha256:test',
            metadata: { localCredentialCount: 0, mirroredCredentialCount: 1 },
            lastConfigAppliedAt: '2026-03-10T10:00:00Z',
            createdAt: '2026-03-10T10:00:00Z',
            updatedAt: '2026-03-10T10:00:00Z',
            drifted: true,
          },
        ],
      },
    });
  });

  it('renders worker hostname and runtime rows', () => {
    renderSection();
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('renders drift and local access counters', () => {
    renderSection();
    expect(screen.getByText('Drifted')).toBeDefined();
    expect(screen.getAllByText('Local access').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mirrored managed').length).toBeGreaterThan(0);
  });

  it('renders sync action affordances', () => {
    renderSection();
    expect(screen.getByText('Inspect local access')).toBeDefined();
    expect(screen.getByText('Sync now')).toBeDefined();
  });
});
