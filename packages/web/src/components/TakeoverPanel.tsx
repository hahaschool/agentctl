'use client';

import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { InteractiveTerminal } from './InteractiveTerminal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TakeoverState = 'connecting' | 'active' | 'releasing';

type TakeoverPanelProps = {
  /** RC session ID (used for release calls). */
  sessionId: string;
  /** Machine ID — forwarded to InteractiveTerminal for WebSocket routing. */
  machineId: string;
  /** Terminal ID returned by the takeover API. */
  terminalId: string;
  /** Called when the panel should close (release completed or PTY exited). */
  onClose: () => void;
  /** Called after a successful release. resume=true means automation restarts. */
  onReleased: (options: { resumed: boolean }) => void;
};

// ---------------------------------------------------------------------------
// TakeoverPanel
// ---------------------------------------------------------------------------

export function TakeoverPanel({
  sessionId,
  machineId,
  terminalId,
  onClose,
  onReleased,
}: TakeoverPanelProps): React.JSX.Element {
  const [takeoverState, setTakeoverState] = useState<TakeoverState>('connecting');
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Track whether PTY already exited so we skip the release call on close
  const ptyExitedRef = useRef(false);

  const handleTerminalConnected = useCallback(() => {
    setTakeoverState('active');
  }, []);

  const handlePtyExit = useCallback(
    (_code: number) => {
      ptyExitedRef.current = true;
      // PTY exited naturally — close without calling release
      onReleased({ resumed: false });
      onClose();
    },
    [onClose, onReleased],
  );

  const handleTerminalError = useCallback((_msg: string) => {
    // Error is shown inside the terminal; we just stay open
  }, []);

  const executeRelease = useCallback(
    async (resume: boolean) => {
      if (ptyExitedRef.current) {
        // Already exited — nothing to release
        onReleased({ resumed: resume });
        onClose();
        return;
      }

      setTakeoverState('releasing');
      setReleaseError(null);

      try {
        const { api } = await import('@/lib/api');
        await api.sessionRelease(sessionId, { resume });
        onReleased({ resumed: resume });
        onClose();
      } catch (err) {
        setReleaseError(err instanceof Error ? err.message : String(err));
        setTakeoverState('active');
      }
    },
    [sessionId, onClose, onReleased],
  );

  // Escape key — ask for confirmation if still active
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      // Don't intercept escape if it's likely being typed into the terminal
      const active = document.activeElement;
      const isInsideTerminal = active instanceof HTMLElement && active.closest('.xterm') !== null;
      if (isInsideTerminal) return;

      if (takeoverState === 'active') {
        setShowConfirmClose(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [takeoverState]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]"
      role="dialog"
      aria-modal="true"
      aria-label="Interactive Takeover Terminal"
    >
      {/* Amber banner */}
      <div className="shrink-0 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3">
        <AlertTriangle className="size-4 text-amber-400 shrink-0" aria-hidden="true" />
        <span className="text-amber-300 text-[13px] font-semibold flex-1">
          Interactive Takeover — you have direct control
        </span>
        {takeoverState === 'connecting' && (
          <span className="flex items-center gap-1.5 text-amber-400/80 text-[12px]">
            <Loader2 className="size-3.5 animate-spin" />
            Connecting…
          </span>
        )}
        {takeoverState === 'releasing' && (
          <span className="flex items-center gap-1.5 text-amber-400/80 text-[12px]">
            <Loader2 className="size-3.5 animate-spin" />
            Releasing…
          </span>
        )}
        {takeoverState === 'active' && (
          <span
            className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"
            role="img"
            aria-label="Active"
            title="Active"
          />
        )}
        {/* Close icon — triggers confirm dialog */}
        <button
          type="button"
          onClick={() => setShowConfirmClose(true)}
          className="ml-1 p-1 rounded hover:bg-amber-500/20 text-amber-400/70 hover:text-amber-300 transition-colors cursor-pointer"
          aria-label="Close takeover panel"
          disabled={takeoverState === 'releasing'}
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Release error */}
      {releaseError && (
        <div className="shrink-0 bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-[12px] text-red-400">
          Release failed: {releaseError}
        </div>
      )}

      {/* Terminal */}
      <div className="flex-1 min-h-0 flex flex-col">
        <InteractiveTerminal
          machineId={machineId}
          terminalId={terminalId}
          onExit={handlePtyExit}
          onError={handleTerminalError}
          onConnected={handleTerminalConnected}
          className="flex-1 min-h-0"
        />
      </div>

      {/* Release button row */}
      <div className="shrink-0 border-t border-border/50 bg-zinc-900/80 px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">
          Session: <span className="font-mono">{sessionId.slice(0, 12)}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void executeRelease(false)}
            disabled={takeoverState !== 'active'}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer',
              'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            Release &amp; Pause
          </button>
          <button
            type="button"
            onClick={() => void executeRelease(true)}
            disabled={takeoverState !== 'active'}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer',
              'bg-amber-600 text-white border-amber-500 hover:bg-amber-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            Release &amp; Resume
          </button>
        </div>
      </div>

      {/* Confirm close dialog */}
      {showConfirmClose && (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-[15px] font-semibold text-foreground mb-2">
              Leave takeover session?
            </h2>
            <p className="text-[13px] text-muted-foreground mb-5">
              The managed agent will stay paused. You can reconnect from the session detail page.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirmClose(false)}
                className="px-4 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={() => void executeRelease(false)}
                className="px-4 py-1.5 text-xs rounded-md bg-zinc-700 text-zinc-100 border border-zinc-600 hover:bg-zinc-600 cursor-pointer"
              >
                Release &amp; Pause
              </button>
              <button
                type="button"
                onClick={() => void executeRelease(true)}
                className="px-4 py-1.5 text-xs rounded-md bg-amber-600 text-white border border-amber-500 hover:bg-amber-500 cursor-pointer"
              >
                Release &amp; Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
