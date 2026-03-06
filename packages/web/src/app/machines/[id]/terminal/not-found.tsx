import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="text-xl font-semibold mb-2 tracking-tight">Machine Not Found</h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-[360px] leading-relaxed">
        The machine you&apos;re trying to connect to doesn&apos;t exist or is no longer available.
      </p>
      <Button asChild size="lg" className="font-medium">
        <Link href="/machines">Back to Machines</Link>
      </Button>
    </div>
  );
}
