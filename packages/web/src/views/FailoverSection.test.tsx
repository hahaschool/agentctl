import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAccountsQuery, mockDefaultsQuery, mockUpdateDefaults, mockToast } = vi.hoisted(() => ({
  mockAccountsQuery: vi.fn(),
  mockDefaultsQuery: vi.fn(),
  mockUpdateDefaults: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
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

vi.mock('../components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../lib/queries', () => ({
  accountsQuery: () => mockAccountsQuery(),
  accountDefaultsQuery: () => mockDefaultsQuery(),
  useUpdateDefaults: () => mockUpdateDefaults(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { FailoverSection } from './FailoverSection';

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Primary',
    provider: 'anthropic_api',
    isActive: true,
    priority: 0,
    credentialMasked: '****',
  },
  {
    id: 'acc-2',
    name: 'Codex Primary',
    provider: 'openai_api',
    isActive: true,
    priority: 1,
    credentialMasked: '****',
  },
];

const MOCK_DEFAULTS = { defaultAccountId: 'acc-1', failoverPolicy: 'priority' };

function renderFailover() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FailoverSection />
    </QueryClientProvider>,
  );
}

describe('FailoverSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });
    mockUpdateDefaults.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('renders the "Routing & autonomy" heading', () => {
    renderFailover();
    const heading = screen.getByText('Routing & autonomy');
    expect(heading).toBeDefined();
    expect(heading.tagName).toBe('H3');
  });

  it('renders the resolution order summary', () => {
    renderFailover();
    expect(screen.getByText(/Session override, then agent runtime profile/)).toBeDefined();
  });

  it('renders "Default managed credential" label', () => {
    renderFailover();
    expect(screen.getByText('Default managed credential')).toBeDefined();
  });

  it('renders account options including OpenAI API credentials', () => {
    renderFailover();
    expect(screen.getByText('Primary (anthropic_api)')).toBeDefined();
    expect(screen.getByText('Codex Primary (openai_api)')).toBeDefined();
  });

  it('renders all three failover policy buttons', () => {
    renderFailover();
    expect(screen.getByText('None')).toBeDefined();
    expect(screen.getByText('Priority')).toBeDefined();
    expect(screen.getByText('Round Robin')).toBeDefined();
  });

  it('renders failover descriptions', () => {
    renderFailover();
    expect(screen.getByText('Use assigned account only')).toBeDefined();
    expect(screen.getByText('Try next active account by priority on rate limit')).toBeDefined();
    expect(screen.getByText('Distribute across all active accounts')).toBeDefined();
  });
});
