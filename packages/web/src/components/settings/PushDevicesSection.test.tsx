import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before the module under test is imported.
// ---------------------------------------------------------------------------

const { mockListPushDevices, mockDeactivatePushDevice } = vi.hoisted(() => ({
  mockListPushDevices: vi.fn(),
  mockDeactivatePushDevice: vi.fn(),
}));

vi.mock('@/lib/queries', async () => {
  const { queryOptions } = await import('@tanstack/react-query');
  const { useMutation, useQueryClient } = await import('@tanstack/react-query');
  return {
    pushDevicesQuery: (userId: string) =>
      queryOptions({
        queryKey: ['push-devices', userId] as const,
        queryFn: () => mockListPushDevices(userId),
        enabled: !!userId,
        retry: false,
      }),
    useDeactivatePushDevice: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, userId }: { id: string; userId: string }) =>
          mockDeactivatePushDevice(id).then((res: { ok: boolean; device: unknown }) => ({
            ...res,
            userId,
          })),
        onSuccess: (_data: unknown, vars: { userId: string }) => {
          void qc.invalidateQueries({ queryKey: ['push-devices', vars.userId] });
        },
      });
    },
  };
});

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import types and the component AFTER the mocks.
import type { MobilePushDevice } from '@/lib/api';

import { PushDevicesSection } from './PushDevicesSection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDevice(overrides: Partial<MobilePushDevice> = {}): MobilePushDevice {
  return {
    id: 'dev-1',
    userId: 'local',
    platform: 'ios',
    provider: 'expo',
    pushToken: 'ExponentPushToken[abcdef]',
    appId: 'com.agentctl.mobile',
    lastSeenAt: '2026-04-10T08:00:00.000Z',
    disabledAt: null,
    createdAt: '2026-04-01T08:00:00.000Z',
    updatedAt: '2026-04-10T08:00:00.000Z',
    ...overrides,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function renderSection(): ReturnType<typeof render> {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <PushDevicesSection />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PushDevicesSection', () => {
  beforeEach(() => {
    mockListPushDevices.mockReset();
    mockDeactivatePushDevice.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading state while the query is in flight', () => {
    // Pending promise — never resolves so the query stays in loading state.
    mockListPushDevices.mockReturnValue(new Promise(() => {}));

    renderSection();

    expect(screen.getByTestId('push-devices-loading')).toBeDefined();
  });

  it('renders a populated device list with platform + timestamps', async () => {
    mockListPushDevices.mockResolvedValue({
      devices: [
        makeDevice({ id: 'dev-1', appId: 'com.agentctl.mobile' }),
        makeDevice({ id: 'dev-2', appId: 'com.agentctl.tv' }),
      ],
    });

    renderSection();

    const row1 = await screen.findByTestId('push-device-row-dev-1');
    const row2 = await screen.findByTestId('push-device-row-dev-2');
    expect(row1).toBeDefined();
    expect(row2).toBeDefined();
    expect(row1.textContent).toContain('com.agentctl.mobile');
    expect(row2.textContent).toContain('com.agentctl.tv');
    // Both rows show the iOS platform badge.
    expect(screen.getAllByText('iOS').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the empty state when no active devices exist', async () => {
    mockListPushDevices.mockResolvedValue({ devices: [] });

    renderSection();

    const empty = await screen.findByTestId('push-devices-empty');
    expect(empty).toBeDefined();
    expect(screen.getByText(/No devices registered/i)).toBeDefined();
    expect(screen.getByText(/Install the iOS app and enable notifications/i)).toBeDefined();
  });

  it('renders the error state when the query rejects', async () => {
    mockListPushDevices.mockRejectedValue(new Error('boom'));

    renderSection();

    const errEl = await screen.findByTestId('push-devices-error');
    expect(errEl).toBeDefined();
    expect(errEl.textContent).toContain('boom');
  });

  it('calls deactivate when revoke button is clicked and confirmed', async () => {
    mockListPushDevices.mockResolvedValue({
      devices: [makeDevice({ id: 'dev-1' })],
    });
    mockDeactivatePushDevice.mockResolvedValue({
      ok: true,
      device: makeDevice({ id: 'dev-1', disabledAt: '2026-04-10T08:30:00.000Z' }),
    });

    // Confirm → proceeds.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSection();

    const revokeBtn = await screen.findByTestId('push-device-revoke-dev-1');
    fireEvent.click(revokeBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockDeactivatePushDevice).toHaveBeenCalledWith('dev-1');
    });
  });

  it('does NOT call deactivate when revoke is cancelled in the confirm dialog', async () => {
    mockListPushDevices.mockResolvedValue({
      devices: [makeDevice({ id: 'dev-1' })],
    });

    // Cancel → no mutation.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderSection();

    const revokeBtn = await screen.findByTestId('push-device-revoke-dev-1');
    fireEvent.click(revokeBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockDeactivatePushDevice).not.toHaveBeenCalled();
  });
});
