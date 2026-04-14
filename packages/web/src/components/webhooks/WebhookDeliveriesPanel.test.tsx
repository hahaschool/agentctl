import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before the module under test is imported.
// ---------------------------------------------------------------------------

const { mockListDeliveries } = vi.hoisted(() => ({
  mockListDeliveries: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  webhookDeliveriesQuery: (id: string) => ({
    queryKey: ['webhook-deliveries', id] as const,
    queryFn: () => mockListDeliveries(id),
    enabled: id.length > 0,
    refetchOnWindowFocus: false,
    retry: false,
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import types and the component AFTER the mocks.
import type { WebhookDelivery } from '@/lib/api';

import { WebhookDeliveriesPanel } from './WebhookDeliveriesPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'del-1',
    subscriptionId: 'sub-1',
    eventType: 'agent.started',
    status: 'delivered',
    statusCode: 200,
    responseBody: '{"ok":true}',
    payload: { foo: 'bar' },
    attempts: 1,
    nextRetryAt: null,
    createdAt: '2026-04-10T08:00:00.000Z',
    deliveredAt: '2026-04-10T08:00:01.000Z',
    ...overrides,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderPanel(subscriptionId = 'sub-1'): ReturnType<typeof render> {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <WebhookDeliveriesPanel subscriptionId={subscriptionId} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookDeliveriesPanel', () => {
  beforeEach(() => {
    mockListDeliveries.mockReset();
  });

  it('shows the loading state while the query is in flight', () => {
    // Pending promise — never resolves so the query stays in loading state.
    mockListDeliveries.mockReturnValue(new Promise(() => {}));

    renderPanel();

    expect(screen.getByTestId('deliveries-loading')).toBeDefined();
  });

  it('renders a populated delivery list and expands a row to show payload + response', async () => {
    mockListDeliveries.mockResolvedValue({
      deliveries: [
        makeDelivery({ id: 'del-1', eventType: 'agent.started', status: 'delivered' }),
        makeDelivery({
          id: 'del-2',
          eventType: 'agent.error',
          status: 'failed',
          statusCode: 500,
          attempts: 3,
        }),
      ],
    });

    renderPanel();

    const row1 = await screen.findByTestId('delivery-row-del-1');
    const row2 = await screen.findByTestId('delivery-row-del-2');
    expect(row1).toBeDefined();
    expect(row2).toBeDefined();

    expect(screen.getByText('agent.started')).toBeDefined();
    expect(screen.getByText('agent.error')).toBeDefined();
    expect(screen.getByText('delivered')).toBeDefined();
    expect(screen.getByText('failed')).toBeDefined();
    expect(screen.getByText('200')).toBeDefined();
    expect(screen.getByText('500')).toBeDefined();
    expect(screen.getByText('×3')).toBeDefined();

    // Row is collapsed by default.
    expect(screen.queryByTestId('delivery-payload-del-1')).toBeNull();

    fireEvent.click(row1.querySelector('button') as HTMLButtonElement);

    const payload = await screen.findByTestId('delivery-payload-del-1');
    expect(payload.textContent).toContain('"foo"');
    expect(payload.textContent).toContain('"bar"');
    const response = screen.getByTestId('delivery-response-del-1');
    expect(response.textContent).toContain('"ok"');
  });

  it('renders the empty state when no deliveries exist', async () => {
    mockListDeliveries.mockResolvedValue({ deliveries: [] });

    renderPanel();

    const empty = await screen.findByTestId('deliveries-empty');
    expect(empty).toBeDefined();
    expect(screen.getByText(/No deliveries yet/i)).toBeDefined();
  });

  it('renders the error state when the query rejects', async () => {
    mockListDeliveries.mockRejectedValue(new Error('boom'));

    renderPanel();

    const errEl = await screen.findByTestId('deliveries-error');
    expect(errEl).toBeDefined();
    expect(errEl.textContent).toContain('boom');
  });
});
