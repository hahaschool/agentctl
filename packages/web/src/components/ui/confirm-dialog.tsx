'use client';

import type React from 'react';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// ConfirmDialog — branded replacement for window.confirm
// ---------------------------------------------------------------------------
//
// Consistent destructive/primary confirmation surface. Handles the common
// async-confirm lifecycle: disables buttons while the callback is in flight,
// surfaces failures inline without leaving the modal open unexpectedly.
//
// Props:
//   - open / onOpenChange: controlled open state
//   - title / description: header text
//   - confirmLabel / cancelLabel: optional overrides (default: Confirm / Cancel)
//   - destructive: renders the confirm button in red
//   - onConfirm: sync or async callback. Dialog auto-closes on resolve.
// ---------------------------------------------------------------------------

export type ConfirmDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void | Promise<void>;
};

const DESTRUCTIVE_CONFIRM_CLASS =
  'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600';
const DEFAULT_DESCRIPTION = 'Confirm this action before continuing.';
const DEFAULT_ERROR_MESSAGE = 'Unable to complete the confirmation. Please try again.';

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : DEFAULT_ERROR_MESSAGE;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirm(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    // Prevent AlertDialog's default auto-close so we can control timing and
    // keep the modal open while the async work is in flight.
    event.preventDefault();
    if (pending) return;

    try {
      setErrorMessage(null);
      setPending(true);
      await onConfirm();
      setErrorMessage(null);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Guard: never allow external close (ESC / overlay) while pending.
        if (pending && !next) return;
        if (next) {
          setErrorMessage(null);
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? DEFAULT_DESCRIPTION}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage && (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            data-testid="confirm-dialog-error"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="confirm-dialog-cancel">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            data-testid="confirm-dialog-confirm"
            data-destructive={destructive ? 'true' : 'false'}
            className={cn(destructive && DESTRUCTIVE_CONFIRM_CLASS)}
          >
            {pending ? `${confirmLabel}…` : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
