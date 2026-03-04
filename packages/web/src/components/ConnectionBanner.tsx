'use client';

import { useEffect, useState } from 'react';

import type { WsConnectionStatus } from '../hooks/use-websocket';

type ConnectionBannerProps = {
  status: WsConnectionStatus;
};

export function ConnectionBanner({ status }: ConnectionBannerProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const isDisconnected = status === 'disconnected';

  // Reset dismiss state when the connection is restored then lost again
  useEffect(() => {
    if (!isDisconnected) setDismissed(false);
  }, [isDisconnected]);

  if (!isDisconnected || dismissed) return null;

  return (
    <div
      className="fixed top-0 right-0 left-0 md:left-[220px] z-30 bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-1.5 text-[12px] text-yellow-600 dark:text-yellow-400 flex items-center justify-between animate-fade-in"
    >
      <span>Connection lost — displayed data may be stale</span>
      <button
        type="button"
        className="text-yellow-600 dark:text-yellow-400 hover:opacity-70 ml-4 text-xs shrink-0"
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </button>
    </div>
  );
}
