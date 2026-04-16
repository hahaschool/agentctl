import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Webhook } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWebhooksQuery,
  mockUseCreateWebhook,
  mockUseUpdateWebhook,
  mockUseDeleteWebhook,
  mockUseTestWebhook,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockWebhooksQuery: vi.fn(),
  mockUseCreateWebhook: vi.fn(),
  mockUseUpdateWebhook: vi.fn(),
  mockUseDeleteWebhook: vi.fn(),
  mockUseTestWebhook: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="error-banner">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: ({ isFetching }: { isFetching: boolean }) => (
    <div data-testid="fetching-bar">{isFetching ? 'fetching' : 'idle'}</div>
  ),
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" disabled={isFetching} onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

vi.mock('@/lib/queries', () => ({
  webhooksQuery: () => mockWebhooksQuery(),
  useCreateWebhook: () => mockUseCreateWebhook(),
  useUpdateWebhook: () => mockUseUpdateWebhook(),
  useDeleteWebhook: () => mockUseDeleteWebhook(),
  useTestWebhook: () => mockUseTestWebhook(),
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { WebhooksPage } from './WebhooksPage';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeWebhook(overrides?: Partial<Webhook>): Webhook {
  return {
    id: 'wh-1',
    url: 'https://example.com/hook',
    provider: 'generic',
    secret: null,
    eventTypes: ['agent.started', 'agent.stopped'],
    agentFilter: null,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMutationHook(
  overrides?: Partial<{
    mutate: ReturnType<typeof vi.fn>;
    isPending: boolean;
    variables: unknown;
  }>,
) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    variables: undefined as unknown,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebhooksPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [makeWebhook()], limit: 50, offset: 0 }),
    });
    mockUseCreateWebhook.mockReturnValue(makeMutationHook());
    mockUseUpdateWebhook.mockReturnValue(makeMutationHook());
    mockUseDeleteWebhook.mockReturnValue(makeMutationHook());
    mockUseTestWebhook.mockReturnValue(makeMutationHook());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading skeletons while webhooks are loading', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('loading-skeletons')).toBeDefined();
    });
  });

  it('renders the empty-state when there are no webhooks', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No webhook subscriptions yet')).toBeDefined();
    });
  });

  it('renders an error banner when the query fails', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('renders webhook rows with URL and events', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({
        subscriptions: [
          makeWebhook({ id: 'wh-a', url: 'https://hook.site/xyz', eventTypes: ['deploy.success'] }),
        ],
        limit: 50,
        offset: 0,
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('https://hook.site/xyz')).toBeDefined();
      expect(screen.getByText('deploy.success')).toBeDefined();
    });
  });

  it('opens the create dialog when "Add Webhook" is clicked', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-webhook')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-webhook'));
    expect(screen.getByTestId('webhook-form-dialog')).toBeDefined();
    expect(screen.getByText('Add webhook')).toBeDefined();
  });

  it('shows validation error when submitting an empty form', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-webhook')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-webhook'));
    fireEvent.click(screen.getByTestId('webhook-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('form-error').textContent).toContain('URL is required');
    });
  });

  it('calls createWebhook.mutate when a valid form is submitted', async () => {
    const mutate = vi.fn();
    mockUseCreateWebhook.mockReturnValue(makeMutationHook({ mutate }));
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-webhook')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-webhook'));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.click(screen.getByTestId('event-agent.started'));
    fireEvent.click(screen.getByTestId('webhook-submit'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [body] = mutate.mock.calls[0] as [Record<string, unknown>];
    expect(body.url).toBe('https://example.com/hook');
    expect(body.eventTypes).toEqual(['agent.started']);
  });

  it('opens the edit dialog pre-filled when the Edit button is clicked', async () => {
    const wh = makeWebhook({
      id: 'wh-edit',
      url: 'https://edit.example.com/x',
      eventTypes: ['agent.error'],
    });
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [wh], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('edit-wh-edit')).toBeDefined());
    fireEvent.click(screen.getByTestId('edit-wh-edit'));

    expect(screen.getByText('Edit webhook')).toBeDefined();
    const urlInput = screen.getByLabelText(/URL/i) as HTMLInputElement;
    expect(urlInput.value).toBe('https://edit.example.com/x');
  });

  it('asks for confirmation before deleting and calls deleteWebhook.mutate on confirm', async () => {
    const mutate = vi.fn();
    mockUseDeleteWebhook.mockReturnValue(makeMutationHook({ mutate }));
    const wh = makeWebhook({ id: 'wh-del' });
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [wh], limit: 50, offset: 0 }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('delete-wh-del')).toBeDefined());
    fireEvent.click(screen.getByTestId('delete-wh-del'));
    expect(screen.getByTestId('webhook-delete-confirm')).toBeDefined();
    fireEvent.click(screen.getByTestId('confirm-delete'));
    expect(mutate).toHaveBeenCalledWith('wh-del', expect.any(Object));
  });

  it('dismisses the delete confirmation when Cancel is pressed', async () => {
    const mutate = vi.fn();
    mockUseDeleteWebhook.mockReturnValue(makeMutationHook({ mutate }));
    const wh = makeWebhook({ id: 'wh-keep' });
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [wh], limit: 50, offset: 0 }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('delete-wh-keep')).toBeDefined());
    fireEvent.click(screen.getByTestId('delete-wh-keep'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('webhook-delete-confirm')).toBeNull();
  });

  it('shows a success toast when a test webhook is delivered', async () => {
    const mutate = vi.fn(
      (
        _id: string,
        opts: {
          onSuccess?: (r: {
            ok: boolean;
            delivery: { statusCode: number | null; status: string };
          }) => void;
        },
      ) => {
        opts.onSuccess?.({ ok: true, delivery: { statusCode: 200, status: 'delivered' } });
      },
    );
    mockUseTestWebhook.mockReturnValue(makeMutationHook({ mutate }));
    const wh = makeWebhook({ id: 'wh-test-ok' });
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [wh], limit: 50, offset: 0 }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('test-wh-test-ok')).toBeDefined());
    fireEvent.click(screen.getByTestId('test-wh-test-ok'));
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('delivered'));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows an error toast when a test webhook fails', async () => {
    const mutate = vi.fn(
      (
        _id: string,
        opts: {
          onSuccess?: (r: {
            ok: boolean;
            delivery: { statusCode: number | null; status: string };
          }) => void;
        },
      ) => {
        opts.onSuccess?.({ ok: false, delivery: { statusCode: 500, status: 'failed' } });
      },
    );
    mockUseTestWebhook.mockReturnValue(makeMutationHook({ mutate }));
    const wh = makeWebhook({ id: 'wh-test-fail' });
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [wh], limit: 50, offset: 0 }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('test-wh-test-fail')).toBeDefined());
    fireEvent.click(screen.getByTestId('test-wh-test-fail'));
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Test failed'));
  });

  it('shows "Testing…" label on the row currently being tested', async () => {
    mockUseTestWebhook.mockReturnValue(makeMutationHook({ isPending: true, variables: 'wh-busy' }));
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({
        subscriptions: [makeWebhook({ id: 'wh-busy' })],
        limit: 50,
        offset: 0,
      }),
    });
    renderPage();
    await waitFor(() => {
      const btn = screen.getByTestId('test-wh-busy') as HTMLButtonElement;
      expect(btn.textContent).toContain('Testing');
      expect(btn.disabled).toBe(true);
    });
  });

  it('renders active / paused state badges', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({
        subscriptions: [
          makeWebhook({ id: 'w-a', active: true }),
          makeWebhook({ id: 'w-b', active: false }),
        ],
        limit: 50,
        offset: 0,
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeDefined();
      expect(screen.getByText('Paused')).toBeDefined();
    });
  });

  it('rejects invalid URLs in the form', async () => {
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-webhook')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-webhook'));

    fireEvent.change(screen.getByLabelText(/URL/i), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByTestId('event-agent.started'));
    fireEvent.click(screen.getByTestId('webhook-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('form-error').textContent).toContain('valid http');
    });
  });

  it('shows inline length error and disables submit when the URL exceeds 2048 chars', async () => {
    const mutate = vi.fn();
    mockUseCreateWebhook.mockReturnValue(makeMutationHook({ mutate }));
    mockWebhooksQuery.mockReturnValue({
      queryKey: ['webhooks'],
      queryFn: vi.fn().mockResolvedValue({ subscriptions: [], limit: 50, offset: 0 }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-webhook')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-webhook'));

    const tooLong = `https://example.com/${'a'.repeat(2048)}`;
    fireEvent.change(screen.getByLabelText(/URL/i), { target: { value: tooLong } });

    await waitFor(() => {
      expect(screen.getByTestId('webhook-url-length-error').textContent).toContain('URL too long');
    });
    const submit = screen.getByTestId('webhook-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mutate).not.toHaveBeenCalled();
  });
});
