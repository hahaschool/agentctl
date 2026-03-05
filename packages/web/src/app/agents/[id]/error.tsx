'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function AgentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6">
      <Card className="max-w-[460px] w-full">
        <CardContent className="pt-6 text-center">
          <div className="text-4xl mb-4 text-red-400">!</div>
          <h1 className="text-xl font-semibold mb-2">Failed to load agent</h1>
          <p className="text-sm text-muted-foreground mb-2">
            The agent could not be loaded. It may have been removed or the server may be
            unavailable.
          </p>
          {error.message && (
            <p className="text-xs font-mono text-muted-foreground bg-muted px-3 py-2 rounded-sm mb-6 break-all">
              {error.message}
            </p>
          )}
          <div className="flex gap-3 justify-center">
            <Button onClick={reset}>Try Again</Button>
            <Button variant="outline" asChild>
              <Link href="/agents">Back to Agents</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
