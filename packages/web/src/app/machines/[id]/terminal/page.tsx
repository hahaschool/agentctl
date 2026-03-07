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
  const [spawning, setSpawning] = useState(true);

  // Ref survives React Strict Mode's unmount/remount cycle.
  // We use it to share the spawn result across mounts so we only spawn once.
  const spawnStateRef = useRef<{
    pending: boolean;
    termId: string | null;
    error: string | null;
  }>({ pending: false, termId: null, error: null });

  // Auto-spawn terminal on mount — Strict Mode safe
  useEffect(() => {
    const state = spawnStateRef.current;

    // If a previous mount already got a result, reuse it
    if (state.termId) {
      setTerminalId(state.termId);
      setSpawning(false);
      return;
    }
    if (state.error) {
      setError(state.error);
      setSpawning(false);
      return;
    }

    // If a spawn is already in-flight from a previous mount, wait for it
    if (state.pending) return;
    state.pending = true;

    api
      .spawnTerminal(machineId, { cols: 120, rows: 30 })
      .then((info) => {
        state.termId = info.id;
        setTerminalId(info.id);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        state.error = message;
        setError(message);
        toast.error('Failed to spawn terminal');
      })
      .finally(() => {
        state.pending = false;
        setSpawning(false);
      });

    // No cleanup — the terminal persists across Strict Mode remounts.
    // Real unmount cleanup is handled by the next effect.
  }, [machineId, toast]);

  // Cleanup terminal when component truly unmounts (navigation away)
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
            <div className="text-center space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <div className="flex items-center gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setSpawning(true);
                    spawnStateRef.current = { pending: true, termId: null, error: null };
                    api
                      .spawnTerminal(machineId, { cols: 120, rows: 30 })
                      .then((info) => {
                        spawnStateRef.current.termId = info.id;
                        setTerminalId(info.id);
                      })
                      .catch((err: unknown) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        spawnStateRef.current.error = msg;
                        setError(msg);
                      })
                      .finally(() => {
                        spawnStateRef.current.pending = false;
                        setSpawning(false);
                      });
                  }}
                >
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/machines/${machineId}`)}
                >
                  Go Back
                </Button>
              </div>
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
