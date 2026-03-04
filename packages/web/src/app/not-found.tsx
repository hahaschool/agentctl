import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="text-7xl font-bold text-muted-foreground/20 mb-6 select-none">404</div>
      <h1 className="text-xl font-semibold mb-2 tracking-tight">Page Not Found</h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-[360px] leading-relaxed">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button asChild size="lg" className="font-medium">
        <Link href="/">Back to Dashboard</Link>
      </Button>
    </div>
  );
}
