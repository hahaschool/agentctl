import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseQuery,
  mockMachinesQuery,
  mockRuntimeConfigDefaultsQuery,
  mockRuntimeConfigDriftQuery,
  mockSyncMutate,
  mockToast,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockRuntimeConfigDefaultsQuery: vi.fn(),
  mockRuntimeConfigDriftQuery: vi.fn(),
  mockSyncMutate: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: unknown) => mockUseQuery(options),
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/queries', () => ({
  machinesQuery: () => mockMachinesQuery(),
  runtimeConfigDefaultsQuery: () => mockRuntimeConfigDefaultsQuery(),
  runtimeConfigDriftQuery: () => mockRuntimeConfigDriftQuery(),
  useSyncRuntimeConfig: () => ({
    mutate: mockSyncMutate,
    isPending: false,
  }),
  useRefreshRuntimeConfig: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { RuntimeAccessSection } from './RuntimeAccessSection';

function setupUseQuery() {
  mockMachinesQuery.mockReturnValue({ queryKey: ['machines'] });
  mockRuntimeConfigDefaultsQuery.mockReturnValue({ queryKey: ['runtime-config', 'defaults'] });
  mockRuntimeConfigDriftQuery.mockReturnValue({ queryKey: ['runtime-config', 'drift'] });

  mockUseQuery.mockImplementation((options: { queryKey?: unknown[] }) => {
    if (JSON.stringify(options.queryKey) === JSON.stringify(['machines'])) {
      return {
        data: [
          {
            id: 'machine-1',
            hostname: 'mac-mini',
            tailscaleIp: '100.0.0.1',
            os: 'darwin',
            arch: 'arm64',
            status: 'online',
            lastHeartbeat: '2026-03-10T09:00:00.000Z',
            capabilities: { docker: true },
            createdAt: '2026-03-10T08:00:00.000Z',
          },
        ],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    }

    if (JSON.stringify(options.queryKey) === JSON.stringify(['runtime-config', 'defaults'])) {
      return {
        data: {
          version: 9,
          hash: 'sha256:cfg-9',
          config: {
            version: 9,
            hash: 'sha256:cfg-9',
            instructions: {
              userGlobal: 'Global instructions',
              projectTemplate: 'Project instructions',
            },
            mcpServers: [],
            skills: [],
            sandbox: 'workspace-write',
            approvalPolicy: 'on-request',
            environmentPolicy: { inherit: ['PATH'], set: {} },
            runtimeOverrides: {
              claudeCode: { model: 'sonnet' },
              codex: { model: 'gpt-5-codex' },
            },
          },
        },
        isLoading: false,
        isError: false,
      };
    }

    if (JSON.stringify(options.queryKey) === JSON.stringify(['runtime-config', 'drift'])) {
      return {
        data: {
          activeVersion: 9,
          activeHash: 'sha256:cfg-9',
          items: [
            {
              id: 'drift-1',
              machineId: 'machine-1',
              runtime: 'claude-code',
              isInstalled: true,
              isAuthenticated: true,
              syncStatus: 'in-sync',
              configVersion: 9,
              configHash: 'sha256:cfg-9',
              metadata: {},
              lastConfigAppliedAt: '2026-03-10T08:30:00.000Z',
              createdAt: '2026-03-10T08:30:00.000Z',
              updatedAt: '2026-03-10T08:30:00.000Z',
              drifted: false,
            },
            {
              id: 'drift-2',
              machineId: 'machine-1',
              runtime: 'codex',
              isInstalled: true,
              isAuthenticated: false,
              syncStatus: 'drifted',
              configVersion: 8,
              configHash: 'sha256:cfg-8',
              metadata: { reason: 'stale config' },
              lastConfigAppliedAt: '2026-03-10T08:00:00.000Z',
              createdAt: '2026-03-10T08:00:00.000Z',
              updatedAt: '2026-03-10T08:00:00.000Z',
              drifted: true,
            },
          ],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    }

    throw new Error(`Unhandled query key: ${JSON.stringify(options.queryKey)}`);
  });
}

describe('RuntimeAccessSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUseQuery();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders machine-local Claude Code and Codex runtime status', () => {
    render(<RuntimeAccessSection />);

    expect(screen.getByText('mac-mini')).toBeDefined();
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
    expect(screen.getByText('Authenticated')).toBeDefined();
    expect(screen.getByText('Not authenticated')).toBeDefined();
  });

  it('renders terminal and login entrypoints', () => {
    render(<RuntimeAccessSection />);

    expect(screen.getByTestId('link-/machines/machine-1/terminal')).toBeDefined();
    expect(screen.getByText('claude login')).toBeDefined();
    expect(screen.getByText('codex login')).toBeDefined();
    expect(
      screen.getByTestId('link-/machines/machine-1/terminal?command=claude%20login'),
    ).toBeDefined();
    expect(
      screen.getByTestId('link-/machines/machine-1/terminal?command=codex%20login'),
    ).toBeDefined();
  });

  it('syncs the selected machine using the active config version', () => {
    render(<RuntimeAccessSection />);

    const syncButtons = screen.getAllByRole('button', { name: 'Sync Config' });
    expect(syncButtons.length).toBeGreaterThan(0);
    fireEvent.click(syncButtons[0]);

    expect(mockSyncMutate).toHaveBeenCalledWith(
      {
        machineIds: ['machine-1'],
        configVersion: 9,
      },
      expect.any(Object),
    );
  });
});
