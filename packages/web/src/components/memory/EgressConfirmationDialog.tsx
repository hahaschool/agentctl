'use client';

import type { EgressSnapshot } from '@agentctl/shared';
import { useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type EgressConfirmationDialogProps = {
  open: boolean;
  snapshot: EgressSnapshot;
  previewToken: string;
  onConfirm: (previewToken: string) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
};

function formatMaybeNumber(value: number | undefined): string | null {
  if (value === undefined) return null;
  return value.toLocaleString();
}

export function EgressConfirmationDialog({
  open,
  snapshot,
  previewToken,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: EgressConfirmationDialogProps): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmed(false);
    }
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm data egress</AlertDialogTitle>
          <AlertDialogDescription>
            Review the outbound request before starting this memory job.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Destination</dt>
            <dd className="text-right text-foreground">{snapshot.providerHost}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="text-right text-foreground">{snapshot.providerModel}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Content</dt>
            <dd className="text-right text-foreground">{snapshot.contentClass}</dd>
          </div>
          {formatMaybeNumber(snapshot.rowCount) ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Rows</dt>
              <dd className="text-right text-foreground">{formatMaybeNumber(snapshot.rowCount)}</dd>
            </div>
          ) : null}
          {formatMaybeNumber(snapshot.fileCount) ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Files</dt>
              <dd className="text-right text-foreground">
                {formatMaybeNumber(snapshot.fileCount)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Token estimate</dt>
            <dd className="text-right text-foreground">
              {snapshot.tokenEstimate.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Estimated cost</dt>
            <dd className="text-right text-foreground">${snapshot.costEstimate.toFixed(4)}</dd>
          </div>
        </dl>

        <label className="flex items-start gap-3 rounded-md border px-3 py-3 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5"
          />
          <span>I confirm this outbound request is expected for this job.</span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onConfirm(previewToken)}
            disabled={!confirmed || isSubmitting}
          >
            Confirm and run
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
