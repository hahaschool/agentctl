import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';

// ---------------------------------------------------------------------------
// Harness — ConfirmDialog is a controlled component, so tests either provide
// a static open value or wrap it in a tiny stateful harness.
// ---------------------------------------------------------------------------

type HarnessOverrides = Partial<Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>>;

function Harness({
  initialOpen = true,
  onConfirm = vi.fn(),
  onOpenChange,
  ...rest
}: HarnessOverrides & {
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(initialOpen);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
      title={rest.title ?? 'Revoke device'}
      description={rest.description}
      confirmLabel={rest.confirmLabel}
      cancelLabel={rest.cancelLabel}
      destructive={rest.destructive}
      onConfirm={onConfirm}
    />
  );
}

describe('ConfirmDialog', () => {
  it('does not render dialog content when closed', () => {
    render(<Harness initialOpen={false} />);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('renders title and description when open', () => {
    render(
      <Harness
        title="Revoke this iOS device?"
        description="Push notifications will stop until re-registered."
      />,
    );
    expect(screen.getByText('Revoke this iOS device?')).toBeDefined();
    expect(screen.getByText('Push notifications will stop until re-registered.')).toBeDefined();
  });

  it('fires onConfirm and closes when the confirm button is clicked', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<Harness onConfirm={onConfirm} onOpenChange={onOpenChange} confirmLabel="Revoke" />);

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes without firing onConfirm when cancel is clicked', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<Harness onConfirm={onConfirm} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies destructive styling when destructive=true', () => {
    render(<Harness destructive />);
    const confirm = screen.getByTestId('confirm-dialog-confirm');
    expect(confirm.getAttribute('data-destructive')).toBe('true');
    expect(confirm.className).toContain('bg-red-600');
  });

  it('uses primary styling (no red classes) when destructive is false', () => {
    render(<Harness destructive={false} />);
    const confirm = screen.getByTestId('confirm-dialog-confirm');
    expect(confirm.getAttribute('data-destructive')).toBe('false');
    expect(confirm.className).not.toContain('bg-red-600');
  });

  it('disables buttons and shows pending label while async onConfirm is in flight', async () => {
    let resolve: (() => void) | undefined;
    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<Harness onConfirm={onConfirm} confirmLabel="Promote" />);

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      const confirm = screen.getByTestId('confirm-dialog-confirm');
      expect(confirm.hasAttribute('disabled')).toBe(true);
      expect(confirm.textContent).toContain('Promote');
      expect(confirm.textContent).toContain('…');
    });

    // Resolve the pending promise so the test cleans up without leaked state.
    resolve?.();
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
