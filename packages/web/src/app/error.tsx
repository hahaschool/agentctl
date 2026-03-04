'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Next.js surfaces errors server-side; no need to log to browser console
  useEffect(() => {
    // Error is available in the component for display
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="text-4xl mb-4 text-red-400">!</div>
      <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-2 max-w-[420px]">
        An unexpected error occurred. This has been logged for investigation.
      </p>
      {error.message && (
        <p className="text-xs font-mono text-muted-foreground bg-muted px-3 py-2 rounded-sm mb-6 max-w-[420px] break-all">
          {error.message}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-sm text-sm font-medium cursor-pointer"
      >
        Try Again
      </button>
    </div>
  );
}
