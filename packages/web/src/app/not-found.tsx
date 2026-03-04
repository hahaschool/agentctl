import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="text-6xl font-bold text-muted-foreground/30 mb-4">404</div>
      <h1 className="text-xl font-semibold mb-2">Page Not Found</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-[360px]">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button asChild>
        <Link href="/">Back to Dashboard</Link>
      </Button>
    </div>
  );
}
