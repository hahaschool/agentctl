import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeAwareMachineSelect } from './RuntimeAwareMachineSelect';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    getRuntimeConfigDrift: vi.fn().mockResolvedValue({
      activeVersion: 1,
      activeHash: 'abc',
      items: [
        {
          id: 'drift-1',
          machineId: 'mac-1',
          runtime: 'claude-code',
          isInstalled: true,
          isAuthenticated: true,
          syncStatus: 'synced',
          configVersion: 1,
          configHash: 'abc',
          metadata: {},
          lastConfigAppliedAt: null,
        },
        {
          id: 'drift-2',
          machineId: 'mac-1',
          runtime: 'codex',
          isInstalled: true,
          isAuthenticated: true,
          syncStatus: 'synced',
          configVersion: 1,
          configHash: 'abc',
          metadata: {},
          lastConfigAppliedAt: null,
        },
        {
          id: 'drift-3',
          machineId: 'ec2-1',
          runtime: 'claude-code',
          isInstalled: true,
          isAuthenticated: true,
          syncStatus: 'synced',
          configVersion: 1,
          configHash: 'abc',
          metadata: {},
          lastConfigAppliedAt: null,
        },
        {
          id: 'drift-4',
          machineId: 'ec2-1',
          runtime: 'codex',
          isInstalled: false,
          isAuthenticated: false,
          syncStatus: 'not_installed',
          configVersion: null,
          configHash: null,
          metadata: {},
          lastConfigAppliedAt: null,
        },
      ],
    }),
  },
}));

// Mock the Toast module
vi.mock('@/components/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
  useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn(), toast: vi.fn() }),
}));

const mockMachines = [
  {
    id: 'mac-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.64.0.1',
    os: 'darwin',
    arch: 'arm64',
    status: 'online' as const,
    lastHeartbeat: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'ec2-1',
    hostname: 'ec2-worker',
    tailscaleIp: '100.64.0.2',
    os: 'linux',
    arch: 'x86_64',
    status: 'online' as const,
    lastHeartbeat: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('RuntimeAwareMachineSelect', () => {
  it('renders all machines', () => {
    const onChange = vi.fn();
    render(
      <RuntimeAwareMachineSelect
        runtime="claude-code"
        value="mac-1"
        onChange={onChange}
        machines={mockMachines}
      />,
      { wrapper: createWrapper() },
    );

    // The trigger should show the selected machine hostname
    expect(screen.getByText('mac-mini')).toBeDefined();
  });

  it('renders without crashing when machines array is empty', () => {
    const onChange = vi.fn();
    render(
      <RuntimeAwareMachineSelect
        runtime="claude-code"
        value=""
        onChange={onChange}
        machines={[]}
      />,
      { wrapper: createWrapper() },
    );

    // Should render the select trigger with placeholder
    expect(screen.getByText('Select machine')).toBeDefined();
  });

  it('shows selected machine hostname in trigger', () => {
    const onChange = vi.fn();
    render(
      <RuntimeAwareMachineSelect
        runtime="claude-code"
        value="ec2-1"
        onChange={onChange}
        machines={mockMachines}
      />,
      { wrapper: createWrapper() },
    );

    // The trigger should display the selected machine's hostname
    expect(screen.getByText('ec2-worker')).toBeDefined();
  });
});
