import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/alert-dialog', () => {
  const Root = ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null;
  const Pass = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Button = ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );

  return {
    AlertDialog: Root,
    AlertDialogContent: Pass,
    AlertDialogHeader: Pass,
    AlertDialogFooter: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogAction: Button,
    AlertDialogCancel: Button,
  };
});

import { EgressConfirmationDialog } from './EgressConfirmationDialog';

const SNAPSHOT = {
  kind: 'embedding-backfill',
  providerKind: 'openai',
  providerModel: 'text-embedding-3-small',
  providerHost: 'https://api.openai.com',
  priceUsdPerMtoken: 0.02,
  rowCount: 120,
  tokenEstimate: 5000,
  costEstimate: 0.0001,
  contentClass: 'memory-facts',
  computedAt: '2026-04-25T00:00:00.000Z',
} as const;

describe('EgressConfirmationDialog', () => {
  it('renders preview details and requires explicit confirmation before running', () => {
    const onConfirm = vi.fn();

    render(
      <EgressConfirmationDialog
        open
        snapshot={SNAPSHOT}
        previewToken="signed-token"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/confirm data egress/i)).toBeDefined();
    expect(screen.getByText('https://api.openai.com')).toBeDefined();

    const confirmButton = screen.getByRole('button', { name: /confirm and run/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/i confirm this outbound request/i));
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledWith('signed-token');
  });
});
