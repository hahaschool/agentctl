'use client';

import { Siren } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useToast } from '@/components/Toast';
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
import { Button } from '@/components/ui/button';
import { useEmergencyStopAll } from '@/lib/queries';

const FLEET_CONFIRM_TOKEN = 'STOP ALL';

type Props = {
  /** Optional override for the trigger label. */
  label?: string;
  /** Optional className applied to the trigger button. */
  className?: string;
};

/**
 * Fleet-wide emergency stop. Fans out to every online worker and kills every
 * active runtime session. Requires the operator to type a confirmation phrase
 * before the destructive call is made.
 */
export function EmergencyStopAllButton({
  label = 'Emergency stop all',
  className,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const emergencyStopAll = useEmergencyStopAll();
  const toast = useToast();

  const phraseMatches = phrase.trim().toUpperCase() === FLEET_CONFIRM_TOKEN;

  const handleClose = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setPhrase('');
    }
  };

  const handleConfirm = (): void => {
    if (!phraseMatches) return;
    emergencyStopAll.mutate(undefined, {
      onSuccess: (data) => {
        const total = data.results.reduce((sum, r) => sum + (r.stoppedCount ?? 0), 0);
        const failed = data.results.filter((r) => r.error).length;
        if (failed === 0) {
          toast.success(`Fleet stop complete — ${total} session(s) killed`);
        } else {
          toast.error(`Fleet stop partial — ${total} killed, ${failed} machine(s) reported errors`);
        }
        handleClose(false);
      },
      onError: (err) => {
        toast.error(`Fleet stop failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={emergencyStopAll.isPending}
        className={
          className ??
          'border-red-500/60 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
        }
        data-testid="emergency-stop-all-button"
      >
        <Siren className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        {emergencyStopAll.isPending ? 'Stopping fleet…' : label}
      </Button>

      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent data-testid="emergency-stop-all-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Emergency stop the entire fleet?</AlertDialogTitle>
            <AlertDialogDescription>
              This kills every active session on every online worker across the mesh. All in-flight
              agent work — local and remote — will be lost. Use only when you need to halt
              everything immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <label htmlFor="emergency-stop-all-phrase" className="text-sm font-medium">
              Type <span className="font-mono text-foreground">{FLEET_CONFIRM_TOKEN}</span> to
              confirm
            </label>
            <input
              id="emergency-stop-all-phrase"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={emergencyStopAll.isPending}
              className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-sm font-mono outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/60"
              data-testid="emergency-stop-all-phrase"
            />
          </div>
          {emergencyStopAll.error && (
            <p className="text-sm text-destructive" role="alert">
              {emergencyStopAll.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emergencyStopAll.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={!phraseMatches || emergencyStopAll.isPending}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
              data-testid="emergency-stop-all-confirm"
            >
              {emergencyStopAll.isPending ? 'Stopping fleet…' : 'Stop entire fleet'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
