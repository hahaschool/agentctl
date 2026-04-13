'use client';

import { AlertTriangle } from 'lucide-react';
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
import { useEmergencyStopAgent } from '@/lib/queries';

type Props = {
  agentId: string;
  /** Optional human-readable agent name surfaced in the confirmation copy. */
  agentName?: string | null;
  /** Override button label. Defaults to "Emergency Stop". */
  label?: string;
  /** Optional className applied to the trigger button (outline destructive variant). */
  className?: string;
};

/**
 * Destructive action that requests an immediate kill of a running agent's session
 * via the control-plane `/api/agents/:id/emergency-stop` route. Always behind a
 * confirmation dialog because it terminates work in progress.
 */
export function EmergencyStopButton({
  agentId,
  agentName,
  label = 'Emergency Stop',
  className,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const emergencyStop = useEmergencyStopAgent();
  const toast = useToast();

  const handleConfirm = (): void => {
    emergencyStop.mutate(agentId, {
      onSuccess: () => {
        toast.success(`Emergency stop sent${agentName ? ` to ${agentName}` : ''}`);
        setOpen(false);
      },
      onError: (err) => {
        toast.error(`Emergency stop failed: ${err instanceof Error ? err.message : String(err)}`);
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
        disabled={emergencyStop.isPending}
        className={
          className ??
          'border-red-500/60 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
        }
        data-testid="emergency-stop-button"
      >
        <AlertTriangle className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        {emergencyStop.isPending ? 'Stopping…' : label}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="emergency-stop-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Emergency stop this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              The running session
              {agentName ? (
                <>
                  {' for '}
                  <span className="font-mono text-foreground">{agentName}</span>
                </>
              ) : null}{' '}
              will be killed immediately. In-flight work will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {emergencyStop.error && (
            <p className="text-sm text-destructive" role="alert">
              {emergencyStop.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emergencyStop.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={emergencyStop.isPending}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
              data-testid="emergency-stop-confirm"
            >
              {emergencyStop.isPending ? 'Stopping…' : 'Emergency stop'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
