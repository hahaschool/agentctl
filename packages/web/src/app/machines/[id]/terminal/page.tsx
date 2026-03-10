'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { InteractiveTerminal } from '@/components/InteractiveTerminal';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { TERMINAL_SPAWN_COLS, TERMINAL_SPAWN_ROWS } from '@/lib/ui-constants';

export default function MachineTerminalPage() {
  const params = useParams<{ id: string }>();
  const machineId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(true);
  const initialCommand = searchParams.get('command')?.trim() || null;

  // Ref survives React Strict Mode's unmount/remount cycle.
  // We use it to share the spawn result across mounts so we only spawn once.
  const spawnStateRef = useRef<{
    pending: boolean;
    termId: string | null;
    error: string | null;
  }>({ pending: false, termId: null, error: null });

  const doSpawn = useCallback(() => {
    const state = spawnStateRef.current;
    state.pending = true;
    setError(null);
    setSpawning(true);
    api
      .spawnTerminal(machineId, { cols: TERMINAL_SPAWN_COLS, rows: TERMINAL_SPAWN_ROWS })
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
  }, [machineId, toast]);

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

    doSpawn();

    // No cleanup — the terminal persists across Strict Mode remounts.
    // Real unmount cleanup is handled by the next effect.
  }, [doSpawn]);

  // Cleanup terminal when component truly unmounts (navigation away)
  useEffect(() => {
    return () => {
      if (terminalId) {
        // Best-effort cleanup — component is unmounting, nowhere to report errors
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
        {initialCommand && (
          <div className="px-4 py-2 border-b border-border bg-muted/40">
            <p className="text-xs font-medium text-muted-foreground">
              Queued command
            </p>
            <code className="mt-1 block text-xs text-foreground">
              {initialCommand}
            </code>
          </div>
        )}
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
                    spawnStateRef.current = { pending: false, termId: null, error: null };
                    doSpawn();
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
            initialCommand={initialCommand ?? undefined}
            onExit={handleExit}
            onError={handleError}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
