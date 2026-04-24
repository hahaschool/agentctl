'use client';

import { Terminal, XCircle } from 'lucide-react';
import type React from 'react';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  machineId: string;
  previousVersion: string;
  localVersion: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  onClose: () => void;
};

/**
 * §33.11 — Failure viewer for peers still on the pre-async peer-update route
 * (anything < v0.8.1 — see `project_mesh_upgrade_incident.md`). Those peers
 * finish the script synchronously and return `exitCode` + `stdoutTail` +
 * `stderrTail` in the error body; this modal renders those tails directly
 * so the operator can see which step of `scripts/peer-update.sh` blew up
 * instead of a terse "exited with code N" toast.
 */
export function PeerUpdateFailureModal({
  machineId,
  previousVersion,
  localVersion,
  exitCode,
  stdoutTail,
  stderrTail,
  onClose,
}: Props): React.JSX.Element {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const hasStderr = stderrTail.trim().length > 0;
  const hasStdout = stdoutTail.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-update-failure-title"
      data-testid="peer-update-failure-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-2xl rounded-md border border-border bg-card shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-muted-foreground" />
            <h2 id="peer-update-failure-title" className="text-sm font-semibold text-foreground">
              Update failed on {machineId}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground">
              {previousVersion} → {localVersion}
            </span>
            <XCircle size={14} className="text-red-400" />
          </div>
        </div>

        <div
          data-testid="peer-update-failure-output"
          className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed bg-[var(--color-terminal-bg)] min-h-[200px] space-y-3"
        >
          {hasStderr && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                stderr tail
              </div>
              <pre
                data-testid="peer-update-failure-stderr"
                className={cn('whitespace-pre-wrap break-all text-red-400')}
              >
                {stderrTail}
              </pre>
            </div>
          )}

          {hasStdout && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                stdout tail
              </div>
              <pre
                data-testid="peer-update-failure-stdout"
                className="whitespace-pre-wrap break-all text-foreground"
              >
                {stdoutTail}
              </pre>
            </div>
          )}

          {!hasStderr && !hasStdout && (
            <div className="text-muted-foreground">
              No script output captured. Check{' '}
              <span className="font-mono">pm2 logs agentctl-cp-beta</span> on the peer for the
              underlying error.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-red-400 font-medium">
            peer-update script exited with code {exitCode}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Peers on older versions run the synchronous (pre-#697) update path. On repeated
            failures, fall back to the manual recovery playbook.
          </p>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              data-testid="peer-update-failure-close"
              className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
