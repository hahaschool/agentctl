import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAccountsQuery,
  mockCreateAccount,
  mockDeleteAccount,
  mockTestAccount,
  mockUpdateAccount,
  mockToast,
  mockInitiateOAuth,
} = vi.hoisted(() => ({
  mockAccountsQuery: vi.fn(),
  mockCreateAccount: { mutateAsync: vi.fn(), isPending: false },
  mockDeleteAccount: { mutateAsync: vi.fn(), isPending: false },
  mockTestAccount: { mutateAsync: vi.fn(), isPending: false },
  mockUpdateAccount: { mutateAsync: vi.fn(), isPending: false },
  mockToast: { success: vi.fn(), error: vi.fn() },
  mockInitiateOAuth: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
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

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
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

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/api', () => ({
  api: {
    initiateOAuth: (...args: unknown[]) => mockInitiateOAuth(...args),
  },
}));

vi.mock('@/lib/queries', () => ({
  accountsQuery: () => mockAccountsQuery(),
  useCreateAccount: () => mockCreateAccount,
  useDeleteAccount: () => mockDeleteAccount,
  useTestAccount: () => mockTestAccount,
  useUpdateAccount: () => mockUpdateAccount,
}));

import { AccountsSection } from './AccountsSection';

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Claude Primary',
    provider: 'anthropic_api',
    credentialMasked: 'sk-ant-****1234',
    priority: 0,
    isActive: true,
    source: 'managed',
    custody: 'control_plane',
    runtimeCompatibility: ['claude-code'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    metadata: {},
    rateLimit: {},
  },
  {
    id: 'acc-2',
    name: 'Codex Primary',
    provider: 'openai_api',
    credentialMasked: 'sk-****5678',
    priority: 1,
    isActive: true,
    source: 'managed',
    custody: 'control_plane',
    runtimeCompatibility: ['codex'],
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    metadata: {},
    rateLimit: {},
  },
];

function renderComponent() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AccountsSection />
    </QueryClientProvider>,
  );
}

describe('AccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the "Credential inventory" heading', () => {
    renderComponent();
    expect(screen.getByText('Credential inventory')).toBeDefined();
  });

  it('renders "Add managed credential" button', () => {
    renderComponent();
    expect(screen.getByText('Add managed credential')).toBeDefined();
  });

  it('renders provider badges including OpenAI API', () => {
    renderComponent();
    expect(screen.getByText('Anthropic API')).toBeDefined();
    expect(screen.getByText('OpenAI API')).toBeDefined();
  });

  it('renders runtime compatibility badges', () => {
    renderComponent();
    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('renders managed source and control plane custody labels', () => {
    renderComponent();
    expect(screen.getAllByText('managed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Custody: control plane/).length).toBeGreaterThan(0);
  });

  it('renders worker-local access explainer cards', () => {
    renderComponent();
    expect(screen.getByText('Adopt discovered credential')).toBeDefined();
    expect(screen.getByText('Reference local credential')).toBeDefined();
  });

  it('opens the dialog with "Add Managed Credential" title', () => {
    renderComponent();
    fireEvent.click(screen.getByText('Add managed credential'));
    expect(screen.getByTestId('dialog')).toBeDefined();
    expect(screen.getByText('Add Managed Credential', { selector: 'h2' })).toBeDefined();
  });

  it('shows OpenAI API as a provider option in the dialog', () => {
    renderComponent();
    fireEvent.click(screen.getByText('Add managed credential'));
    const dialog = screen.getByTestId('dialog');
    expect(within(dialog).getByText('OpenAI API', { selector: 'option' })).toBeDefined();
  });

  it('shows the new empty state copy', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue([]),
      initialData: [],
    });
    renderComponent();
    expect(screen.getByText(/No managed credentials configured yet/)).toBeDefined();
  });
});
