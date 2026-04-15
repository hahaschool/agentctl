import type { AutoUpdateStatus } from '@agentctl/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStatusQuery, mockToggleMutation, mockStreamDryRun } = vi.hoisted(() => ({
  mockStatusQuery: vi.fn(),
  mockToggleMutation: vi.fn(),
  mockStreamDryRun: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span {...props}>{children as React.ReactNode}</span>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/lib/queries', () => ({
  meshAutoUpdateQuery: () => mockStatusQuery(),
  useToggleMeshAutoUpdate: () => mockToggleMutation(),
}));

vi.mock('@/lib/api/mesh-auto-update', () => ({
  streamAutoUpdateDryRun: (...args: unknown[]) => mockStreamDryRun(...args),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { MeshAutoUpdateSection } from './MeshAutoUpdateSection';

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MeshAutoUpdateSection />
    </QueryClientProvider>,
  );
}

function setStatus(status: AutoUpdateStatus): void {
  mockStatusQuery.mockReturnValue({
    queryKey: ['mesh-auto-update'],
    queryFn: vi.fn().mockResolvedValue(status),
    initialData: status,
  });
}

function setToggle(overrides: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean }>) {
  const mutate = overrides.mutate ?? vi.fn();
  mockToggleMutation.mockReturnValue({
    mutate,
    isPending: overrides.isPending ?? false,
  });
  return mutate;
}

describe('MeshAutoUpdateSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setToggle({});
    mockStreamDryRun.mockResolvedValue(undefined);
  });

  it('renders the disabled state with no prior runs', () => {
    setStatus({
      enabled: false,
      nextScheduledRun: null,
      lastRun: null,
      platform: 'darwin',
    });

    renderSection();
    expect(screen.getByText('Mesh auto-update')).toBeDefined();
    expect(screen.getByText('Disabled')).toBeDefined();
    expect(screen.getByText('No runs recorded yet for this node.')).toBeDefined();
    expect(screen.getByText('Enable')).toBeDefined();
    expect(screen.getByText('Run dry-run now')).toBeDefined();
  });

  it('renders the enabled state + successful last run', () => {
    setStatus({
      enabled: true,
      nextScheduledRun: '2026-04-16T03:00:00.000Z',
      lastRun: {
        version: 'v0.3.4',
        startedAt: '2026-04-15T03:00:00.000Z',
        durationMs: 125_000,
        status: 'success',
        dryRun: false,
      },
      platform: 'darwin',
    });

    renderSection();
    expect(screen.getByText('Enabled')).toBeDefined();
    expect(screen.getByText(/Succeeded — v0\.3\.4/)).toBeDefined();
    expect(screen.getByText('Disable')).toBeDefined();
  });

  it('renders a failure last-run with error detail', () => {
    setStatus({
      enabled: true,
      nextScheduledRun: '2026-04-16T03:00:00.000Z',
      lastRun: {
        version: 'v0.3.5',
        startedAt: '2026-04-15T03:00:00.000Z',
        durationMs: 45_000,
        status: 'failure',
        error: 'pnpm build failed',
        dryRun: false,
      },
      platform: 'linux',
    });

    renderSection();
    expect(screen.getByText(/Failed — v0\.3\.5/)).toBeDefined();
    expect(screen.getByText('pnpm build failed')).toBeDefined();
  });

  it('disables the toggle button on unsupported platforms', () => {
    setStatus({
      enabled: false,
      nextScheduledRun: null,
      lastRun: null,
      platform: 'unsupported',
    });
    renderSection();
    const enableBtn = screen.getByText('Enable') as HTMLButtonElement;
    expect(enableBtn.disabled).toBe(true);
  });

  it('calls the toggle mutation when the Enable button is clicked', () => {
    setStatus({
      enabled: false,
      nextScheduledRun: null,
      lastRun: null,
      platform: 'darwin',
    });
    const mutate = setToggle({});
    renderSection();

    fireEvent.click(screen.getByText('Enable'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ enabled: true });
  });

  it('invokes the dry-run stream when the dry-run button is clicked', () => {
    setStatus({
      enabled: true,
      nextScheduledRun: '2026-04-16T03:00:00.000Z',
      lastRun: null,
      platform: 'darwin',
    });
    renderSection();

    fireEvent.click(screen.getByText('Run dry-run now'));
    expect(mockStreamDryRun).toHaveBeenCalledTimes(1);
    expect(typeof mockStreamDryRun.mock.calls[0][0]).toBe('function');
  });
});
