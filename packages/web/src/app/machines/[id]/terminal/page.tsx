'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { InteractiveTerminal } from '@/components/InteractiveTerminal';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function MachineTerminalPage() {
  const params = useParams<{ id: string }>();
  const machineId = params.id;
  const router = useRouter();
  const toast = useToast();
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const spawnedRef = useRef(false);

  // Auto-spawn terminal on mount
  useEffect(() => {
    // Prevent double-spawn in React strict mode
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    let cancelled = false;
    setSpawning(true);

    api
      .spawnTerminal(machineId, { cols: 120, rows: 30 })
      .then((info) => {
        if (!cancelled) setTerminalId(info.id);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          toast.error('Failed to spawn terminal');
        }
      })
      .finally(() => {
        if (!cancelled) setSpawning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [machineId, toast]);

  // Cleanup terminal on unmount
  useEffect(() => {
    return () => {
      if (terminalId) {
        api.killTerminal(machineId, terminalId).catch(() => {});
      }
    };
  }, [machineId, terminalId]);

  const handleExit = useCallback(
    (code: number) => {
      toast.info(`Terminal process exited with code ${String(code)}`);
    },
    [toast],
  );

  const handleError = useCallback(
    (msg: string) => {
      toast.error(msg);
    },
    [toast],
  );

  return (
    <div className="flex flex-col h-full animate-page-enter">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Breadcrumb
            items={[
              { label: 'Machines', href: '/machines' },
              { label: machineId.slice(0, 12), href: `/machines/${machineId}` },
              { label: 'Terminal' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(`/machines/${machineId}`)}>
            Close
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {spawning && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-muted-foreground animate-pulse">
              Connecting to terminal...
            </span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/machines/${machineId}`)}
              >
                Go Back
              </Button>
            </div>
          </div>
        )}
        {terminalId && !error && (
          <InteractiveTerminal
            machineId={machineId}
            terminalId={terminalId}
            onExit={handleExit}
            onError={handleError}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
