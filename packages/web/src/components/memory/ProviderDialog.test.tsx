import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMemoryProvidersApi } = vi.hoisted(() => ({
  mockMemoryProvidersApi: {
    testEphemeral: vi.fn(),
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="provider-dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  memoryProvidersApi: mockMemoryProvidersApi,
}));

import { ProviderDialog } from './ProviderDialog';

describe('ProviderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    render(<ProviderDialog open={false} onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.queryByTestId('provider-dialog-root')).toBeNull();
  });

  it('shows only verified catalog entries', () => {
    render(<ProviderDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText('OpenAI')).toBeDefined();
    expect(screen.getByText('text-embedding-3-small')).toBeDefined();
    expect(screen.queryByText(/gemini/i)).toBeNull();
  });

  it('keeps save disabled until the current credential has passed an ephemeral test', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    mockMemoryProvidersApi.testEphemeral.mockResolvedValue({
      ok: true,
      dim: 1536,
      model: 'text-embedding-3-small',
      costUsd: 0.000001,
      latencyMs: 85,
      signedToken: 'opaque-test-token',
    });

    render(<ProviderDialog open onOpenChange={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'OpenAI memory' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-api-key' } });

    expect(screen.getByRole('button', { name: 'Save provider' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Test credential' }));

    await waitFor(() => {
      expect(screen.getByText(/dim 1536/i)).toBeDefined();
    });
    expect(screen.getByRole('button', { name: 'Save provider' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'OpenAI memory',
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-api-key',
        active: true,
        recentTestResult: {
          signedToken: 'opaque-test-token',
          apiKey: 'test-api-key',
        },
      });
    });
  });

  it('invalidates the successful test when the API key changes', async () => {
    mockMemoryProvidersApi.testEphemeral.mockResolvedValue({
      ok: true,
      dim: 1536,
      model: 'text-embedding-3-small',
      costUsd: 0.000001,
      latencyMs: 85,
      signedToken: 'opaque-test-token',
    });

    render(<ProviderDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'OpenAI memory' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-api-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test credential' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save provider' })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'different-key' } });

    expect(screen.getByRole('button', { name: 'Save provider' })).toBeDisabled();
  });

  it('shows the machine-local custody warning', () => {
    render(<ProviderDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText(/available only on this machine/i)).toBeDefined();
  });
});
