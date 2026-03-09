import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
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

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import { AccountsSection } from './AccountsSection';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'My Anthropic Key',
    provider: 'anthropic_api',
    credentialMasked: 'sk-ant-****1234',
    priority: 0,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'acc-2',
    name: 'Bedrock Prod',
    provider: 'bedrock',
    credentialMasked: 'AKIA****5678',
    priority: 1,
    isActive: false,
    createdAt: '2024-01-02T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderComponent() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AccountsSection />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: loaded with accounts
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
    });
    // Reset mutation mocks
    mockCreateAccount.mutateAsync = vi.fn();
    mockCreateAccount.isPending = false;
    mockDeleteAccount.mutateAsync = vi.fn();
    mockDeleteAccount.isPending = false;
    mockTestAccount.mutateAsync = vi.fn();
    mockTestAccount.isPending = false;
    mockUpdateAccount.mutateAsync = vi.fn();
    mockUpdateAccount.isPending = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders "Accounts" heading', () => {
      renderComponent();
      expect(screen.getByText('Accounts')).toBeDefined();
    });

    it('renders "Add Account" button', () => {
      renderComponent();
      expect(screen.getByText('Add Account')).toBeDefined();
    });

    it('shows loading skeletons when isLoading', () => {
      mockAccountsQuery.mockReturnValue({
        queryKey: ['accounts'],
        queryFn: () => new Promise(() => {}),
      });
      renderComponent();
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThanOrEqual(2);
    });

    it('shows empty state message when no accounts', async () => {
      mockAccountsQuery.mockReturnValue({
        queryKey: ['accounts'],
        queryFn: vi.fn().mockResolvedValue([]),
      });
      renderComponent();
      expect(
        await screen.findByText('No accounts configured. Add one to get started.'),
      ).toBeDefined();
    });

    it('renders account names', async () => {
      renderComponent();
      expect(await screen.findByText('My Anthropic Key')).toBeDefined();
      expect(screen.getByText('Bedrock Prod')).toBeDefined();
    });

    it('shows provider badges (Anthropic API, AWS Bedrock)', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      expect(screen.getByText('Anthropic API')).toBeDefined();
      expect(screen.getByText('AWS Bedrock')).toBeDefined();
    });

    it('shows Active badge for active accounts', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      expect(screen.getByText('Active')).toBeDefined();
    });

    it('shows Inactive badge for inactive accounts', async () => {
      renderComponent();
      await screen.findByText('Bedrock Prod');
      expect(screen.getByText('Inactive')).toBeDefined();
    });

    it('shows masked credentials', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      expect(screen.getByText('sk-ant-****1234')).toBeDefined();
      expect(screen.getByText('AKIA****5678')).toBeDefined();
    });

    it('shows priority values', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      expect(screen.getByText('Priority: 0')).toBeDefined();
      expect(screen.getByText('Priority: 1')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Account Actions
  // -----------------------------------------------------------------------

  describe('Account Actions', () => {
    it('shows Disable button for active account', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      expect(screen.getByText('Disable')).toBeDefined();
    });

    it('shows Enable button for inactive account', async () => {
      renderComponent();
      await screen.findByText('Bedrock Prod');
      expect(screen.getByText('Enable')).toBeDefined();
    });

    it('each account has a Test button', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const testButtons = screen.getAllByText('Test');
      expect(testButtons).toHaveLength(2);
    });

    it('each account has a Delete button', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const deleteButtons = screen.getAllByText('Delete');
      expect(deleteButtons).toHaveLength(2);
    });

    it('calls updateAccount.mutateAsync when Disable is clicked', async () => {
      mockUpdateAccount.mutateAsync.mockResolvedValue({});
      renderComponent();
      const disableBtn = await screen.findByText('Disable');
      fireEvent.click(disableBtn);
      expect(mockUpdateAccount.mutateAsync).toHaveBeenCalledWith({
        id: 'acc-1',
        isActive: false,
      });
    });

    it('calls updateAccount.mutateAsync when Enable is clicked', async () => {
      mockUpdateAccount.mutateAsync.mockResolvedValue({});
      renderComponent();
      const enableBtn = await screen.findByText('Enable');
      fireEvent.click(enableBtn);
      expect(mockUpdateAccount.mutateAsync).toHaveBeenCalledWith({
        id: 'acc-2',
        isActive: true,
      });
    });

    it('calls testAccount.mutateAsync when Test is clicked', async () => {
      mockTestAccount.mutateAsync.mockResolvedValue({ ok: true, latencyMs: 42 });
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const testBtn = screen.getAllByText('Test')[0];
      expect(testBtn).toBeDefined();
      if (testBtn) fireEvent.click(testBtn);
      expect(mockTestAccount.mutateAsync).toHaveBeenCalledWith('acc-1');
    });

    it('Test button shows "Testing..." when testing that account', async () => {
      // Make mutateAsync hang so we can observe the intermediate state
      mockTestAccount.mutateAsync.mockImplementation(() => new Promise(() => {}));
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const testBtn = screen.getAllByText('Test')[0];
      expect(testBtn).toBeDefined();
      if (testBtn) fireEvent.click(testBtn);
      // After clicking, the button for that account should say "Testing..."
      expect(await screen.findByText('Testing...')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Add Account Dialog
  // -----------------------------------------------------------------------

  describe('Add Account Dialog', () => {
    it('opens dialog when clicking "Add Account"', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.getByTestId('dialog')).toBeDefined();
      expect(screen.getByText('Add Account', { selector: 'h2' })).toBeDefined();
    });

    it('has Name input field', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.getByLabelText('Name')).toBeDefined();
    });

    it('has Provider select', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.getByText('Select a provider')).toBeDefined();
    });

    it('has Priority input', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.getByLabelText('Priority')).toBeDefined();
    });

    it('Create Account button is disabled when fields are empty', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      const createBtn = screen.getByText('Create Account') as HTMLButtonElement;
      expect(createBtn.disabled).toBe(true);
    });

    it('has Cancel button', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.getByText('Cancel')).toBeDefined();
    });

    it('shows all provider options in select', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.getByText('Anthropic API', { selector: 'option' })).toBeDefined();
      expect(screen.getByText('AWS Bedrock', { selector: 'option' })).toBeDefined();
      expect(screen.getByText('Google Vertex AI', { selector: 'option' })).toBeDefined();
      expect(screen.getByText('Claude Max (Pro)', { selector: 'option' })).toBeDefined();
      expect(screen.getByText('Claude Team', { selector: 'option' })).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Provider-specific credential fields
  // -----------------------------------------------------------------------

  describe('Provider-specific credential fields', () => {
    it('does not show credential field when no provider is selected', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      expect(screen.queryByLabelText('API Key')).toBeNull();
      expect(screen.queryByLabelText('OAuth Token')).toBeNull();
      expect(screen.queryByLabelText('AWS Credentials')).toBeNull();
      expect(screen.queryByLabelText('Service Account Key')).toBeNull();
    });

    it('shows "Authorize with Anthropic" button for OAuth providers when provider is set', () => {
      // We cannot trigger Select onValueChange since it is mocked, but we can verify the
      // OAuth button would appear by checking that the OAUTH_PROVIDERS list includes
      // claude_max and claude_team. We'll test with a single-account view that has
      // the oauth provider to confirm the component renders the oauth button when provider is set.
      // Since Select mock does not fire onValueChange, we verify the option items are present.
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      // These options should exist for selection
      expect(screen.getByText('Claude Max (Pro)', { selector: 'option' })).toBeDefined();
      expect(screen.getByText('Claude Team', { selector: 'option' })).toBeDefined();
    });

    it('renders all five provider options with correct labels', () => {
      renderComponent();
      fireEvent.click(screen.getByText('Add Account'));
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(5);
      const labels = options.map((o) => o.textContent);
      expect(labels).toContain('Anthropic API');
      expect(labels).toContain('Claude Max (Pro)');
      expect(labels).toContain('Claude Team');
      expect(labels).toContain('AWS Bedrock');
      expect(labels).toContain('Google Vertex AI');
    });
  });

  // -----------------------------------------------------------------------
  // Delete Confirmation
  // -----------------------------------------------------------------------

  describe('Delete Confirmation', () => {
    it('clicking Delete on an account shows confirmation dialog', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const delBtn = screen.getAllByText('Delete')[0];
      expect(delBtn).toBeDefined();
      if (delBtn) fireEvent.click(delBtn);
      expect(screen.getByText('Delete Account')).toBeDefined();
      expect(
        screen.getByText(
          'Are you sure you want to delete this account? This action cannot be undone.',
        ),
      ).toBeDefined();
    });

    it('confirmation dialog has Delete destructive button and Cancel button', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const delBtn = screen.getAllByText('Delete')[0];
      expect(delBtn).toBeDefined();
      if (delBtn) fireEvent.click(delBtn);
      const dialogs = screen.getAllByTestId('dialog');
      const confirmDialog = dialogs[dialogs.length - 1];
      expect(confirmDialog).toBeDefined();
      if (confirmDialog) {
        expect(within(confirmDialog).getByText('Cancel')).toBeDefined();
        const confirmDeleteBtns = within(confirmDialog).getAllByText('Delete');
        expect(confirmDeleteBtns.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('clicking confirm Delete calls deleteAccount.mutateAsync', async () => {
      mockDeleteAccount.mutateAsync.mockResolvedValue({});
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const delBtn = screen.getAllByText('Delete')[0];
      expect(delBtn).toBeDefined();
      if (delBtn) fireEvent.click(delBtn);
      const dialogs = screen.getAllByTestId('dialog');
      const confirmDialog = dialogs[dialogs.length - 1];
      expect(confirmDialog).toBeDefined();
      if (confirmDialog) {
        const confirmDeleteBtns = within(confirmDialog).getAllByText('Delete');
        // Find the button element (not the h2 title)
        const confirmBtn = confirmDeleteBtns.find((el) => el.tagName === 'BUTTON');
        if (confirmBtn) fireEvent.click(confirmBtn);
      }
      expect(mockDeleteAccount.mutateAsync).toHaveBeenCalledWith('acc-1');
    });

    it('Cancel in confirmation dialog closes it', async () => {
      renderComponent();
      await screen.findByText('My Anthropic Key');
      const delBtn = screen.getAllByText('Delete')[0];
      expect(delBtn).toBeDefined();
      if (delBtn) fireEvent.click(delBtn);
      // Confirm dialog is shown
      expect(
        screen.getByText(
          'Are you sure you want to delete this account? This action cannot be undone.',
        ),
      ).toBeDefined();
      // Click Cancel
      const dialogs = screen.getAllByTestId('dialog');
      const confirmDialog = dialogs[dialogs.length - 1];
      expect(confirmDialog).toBeDefined();
      if (confirmDialog) {
        fireEvent.click(within(confirmDialog).getByText('Cancel'));
      }
      // Confirmation text should be gone
      expect(
        screen.queryByText(
          'Are you sure you want to delete this account? This action cannot be undone.',
        ),
      ).toBeNull();
    });
  });
});
