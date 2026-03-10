import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseQuery,
  mockRuntimeConfigDefaultsQuery,
  mockRuntimeConfigDriftQuery,
  mockUpdateMutate,
  mockSyncMutate,
  mockToast,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockRuntimeConfigDefaultsQuery: vi.fn(),
  mockRuntimeConfigDriftQuery: vi.fn(),
  mockUpdateMutate: vi.fn(),
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

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/queries', () => ({
  runtimeConfigDefaultsQuery: () => mockRuntimeConfigDefaultsQuery(),
  runtimeConfigDriftQuery: () => mockRuntimeConfigDriftQuery(),
  useUpdateRuntimeConfigDefaults: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
  useSyncRuntimeConfig: () => ({
    mutate: mockSyncMutate,
    isPending: false,
  }),
}));

import { RuntimeConsistencySection } from './RuntimeConsistencySection';

function setupUseQuery() {
  mockRuntimeConfigDefaultsQuery.mockReturnValue({ queryKey: ['runtime-config', 'defaults'] });
  mockRuntimeConfigDriftQuery.mockReturnValue({ queryKey: ['runtime-config', 'drift'] });

  mockUseQuery.mockImplementation((options: { queryKey?: unknown[] }) => {
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
            environmentPolicy: { inherit: ['PATH', 'HOME'], set: { FOO: 'bar' } },
            runtimeOverrides: {
              claudeCode: { model: 'sonnet' },
              codex: { model: 'gpt-5-codex' },
            },
          },
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
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
            {
              id: 'drift-3',
              machineId: 'machine-1',
              runtime: 'claude-code',
              isInstalled: true,
              isAuthenticated: true,
              syncStatus: 'drifted',
              configVersion: 8,
              configHash: 'sha256:cfg-8',
              metadata: {},
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

describe('RuntimeConsistencySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUseQuery();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders defaults form fields and drift rows', () => {
    render(<RuntimeConsistencySection />);

    expect(screen.getByDisplayValue('Global instructions')).toBeDefined();
    expect(screen.getByDisplayValue('Project instructions')).toBeDefined();
    expect(screen.getAllByText('machine-1').length).toBeGreaterThan(0);
    expect(screen.getByText('stale config')).toBeDefined();
  });

  it('saves managed runtime defaults', () => {
    render(<RuntimeConsistencySection />);

    fireEvent.change(screen.getByLabelText('Global instructions'), {
      target: { value: 'Updated global instructions' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Defaults' }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 9,
        instructions: expect.objectContaining({
          userGlobal: 'Updated global instructions',
        }),
      }),
      expect.any(Object),
    );
  });

  it('syncs only unique drifted machines', () => {
    render(<RuntimeConsistencySection />);

    fireEvent.click(screen.getByRole('button', { name: 'Sync Drifted Machines' }));

    expect(mockSyncMutate).toHaveBeenCalledWith(
      {
        machineIds: ['machine-1'],
        configVersion: 9,
      },
      expect.any(Object),
    );
  });
});
