'use client';

import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function LogsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6">
      <Card className="max-w-[460px] w-full">
        <CardContent className="pt-6 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4 mx-auto">
            <AlertTriangle size={24} className="text-destructive" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Failed to load logs</h1>
          <p className="text-sm text-muted-foreground mb-4">
            The logs could not be loaded. The server may be unavailable or there may be a connection
            issue.
          </p>
          {error.message && (
            <div className="mb-6">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer mb-2"
                onClick={() => setShowDetails((v) => !v)}
              >
                {showDetails ? 'Hide' : 'Show'} error details
              </button>
              {showDetails && (
                <pre className="text-xs font-mono text-destructive bg-destructive/10 px-3 py-2 rounded-md break-all whitespace-pre-wrap text-left overflow-auto max-h-[200px]">
                  {error.message}
                  {error.stack && `\n\n${error.stack}`}
                </pre>
              )}
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <Button onClick={() => router.back()} variant="outline" size="sm">
              <ArrowLeft size={14} className="mr-1.5" />
              Go Back
            </Button>
            <Button onClick={reset} size="sm">
              <RefreshCw size={14} className="mr-1.5" />
              Try Again
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/">Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
