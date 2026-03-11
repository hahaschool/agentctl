'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { WsConnectionStatus } from '../hooks/use-websocket';

type ConnectionBannerProps = {
  status: WsConnectionStatus;
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function ConnectionBanner({ status }: ConnectionBannerProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const disconnectedAtRef = useRef<number | null>(null);
  const isDisconnected = status === 'disconnected';

  // Track when the disconnection started and tick elapsed time
  useEffect(() => {
    if (!isDisconnected) {
      setDismissed(false);
      setElapsed(0);
      disconnectedAtRef.current = null;
      return;
    }

    if (disconnectedAtRef.current === null) {
      disconnectedAtRef.current = Date.now();
    }

    const tick = () => {
      if (disconnectedAtRef.current !== null) {
        setElapsed(Math.floor((Date.now() - disconnectedAtRef.current) / 1000));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isDisconnected]);

  if (!isDisconnected || dismissed) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 right-0 left-0 md:left-[60px] lg:left-[220px] z-30 bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-1.5 text-[12px] text-yellow-600 dark:text-yellow-400 flex items-center justify-between animate-banner-pulse"
    >
      <span className="flex items-center gap-1.5">
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Connection lost — Disconnected {formatElapsed(elapsed)}
      </span>
      <span className="flex items-center gap-2 shrink-0 ml-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium bg-yellow-500/20 hover:bg-yellow-500/30 transition-colors text-yellow-700 dark:text-yellow-300 text-xs"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Retry now
        </button>
        <button
          type="button"
          className="text-yellow-600 dark:text-yellow-400 hover:opacity-70 text-xs"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
