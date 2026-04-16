'use client';

import { CheckCircle, Loader2, Terminal, XCircle } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PeerUpdateLogLine, PeerUpdateStatusEvent } from '@/lib/api/sync';
import { connectUpdateLogStream } from '@/lib/api/sync';
import { cn } from '@/lib/utils';

type Props = {
  machineId: string;
  jobId: string;
  previousVersion: string;
  localVersion: string;
  onClose: () => void;
};

type LogEntry = PeerUpdateLogLine & { key: number };

/**
 * §33.11 — Live log viewer for peer updates. Connects to the SSE endpoint
 * and streams stdout/stderr in a terminal-style panel. Shows final result
 * when the job completes or the connection drops (expected on pm2 reload).
 */
export function PeerUpdateLogModal({
  machineId,
  jobId,
  previousVersion,
  localVersion,
  onClose,
}: Props): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<PeerUpdateStatusEvent | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef(0);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const abort = connectUpdateLogStream(machineId, jobId, {
      onLog: (line) => {
        keyRef.current += 1;
        setLogs((prev) => [...prev, { ...line, key: keyRef.current }]);
      },
      onStatus: (s) => {
        setStatus(s);
      },
      onError: (err) => {
        setError(err);
      },
      onDisconnect: () => {
        setDisconnected(true);
      },
    });

    return abort;
  }, [machineId, jobId]);

  const isRunning = !status && !disconnected;
  const isSuccess = status?.status === 'success';
  const isFailed = status?.status === 'failed';
  // SSE disconnect without a final status = pm2 reload killed the process (likely success)
  const isDisconnectedNoStatus = disconnected && !status;

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-update-log-title"
      data-testid="peer-update-log-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-2xl rounded-md border border-border bg-card shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-muted-foreground" />
            <h2 id="peer-update-log-title" className="text-sm font-semibold text-foreground">
              Updating {machineId}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground">
              {previousVersion} → {localVersion}
            </span>
            {isRunning && <Loader2 size={14} className="animate-spin text-blue-400" />}
            {isSuccess && <CheckCircle size={14} className="text-green-400" />}
            {isFailed && <XCircle size={14} className="text-red-400" />}
            {isDisconnectedNoStatus && (
              <Loader2 size={14} className="animate-spin text-yellow-400" />
            )}
          </div>
        </div>

        {/* Log output */}
        <div
          data-testid="peer-update-log-output"
          className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed bg-[var(--color-terminal-bg)] min-h-[200px]"
        >
          {logs.length === 0 && isRunning && (
            <div className="text-muted-foreground animate-pulse">Waiting for output...</div>
          )}
          {logs.map((entry) => (
            <div
              key={entry.key}
              className={cn(
                'whitespace-pre-wrap break-all',
                entry.stream === 'stderr' ? 'text-red-400' : 'text-foreground',
              )}
            >
              {entry.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Status footer */}
        <div className="px-4 py-3 border-t border-border">
          {isRunning && (
            <p className="text-xs text-muted-foreground">
              Update is running... logs stream in real time.
            </p>
          )}

          {isSuccess && status.result && (
            <div className="space-y-1">
              <p className="text-xs text-green-400 font-medium">Update completed successfully</p>
              <p className="text-[11px] text-muted-foreground font-mono">
                {status.result.previousVersion} → {status.result.newVersion}
                {' · '}
                {Math.round(status.result.durationMs / 1000)}s{' · '}
                exit {status.result.exitCode}
              </p>
            </div>
          )}

          {isFailed && (
            <div className="space-y-1">
              <p className="text-xs text-red-400 font-medium">Update failed</p>
              {status.error && (
                <p className="text-[11px] text-red-300/80 font-mono break-all">{status.error}</p>
              )}
              {status.result && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  exit {status.result.exitCode}
                  {' · '}
                  {Math.round(status.result.durationMs / 1000)}s
                </p>
              )}
            </div>
          )}

          {isDisconnectedNoStatus && (
            <div className="space-y-1">
              <p className="text-xs text-yellow-400 font-medium">
                Connection lost — update may have completed
              </p>
              <p className="text-[11px] text-muted-foreground">
                The peer process restarted (expected after pm2 reload). Refresh the peer list to
                check the new version.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-400 mt-1">Stream error: {error}</p>}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              data-testid="peer-update-log-close"
              className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10"
            >
              {isRunning ? 'Close (update continues)' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
