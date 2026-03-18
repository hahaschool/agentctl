import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DiscoverPage } from '@/views/DiscoverPage';

export const metadata: Metadata = { title: 'Discover' };

export default function Page() {
  return (
    <ErrorBoundary>
      <DiscoverPage />
    </ErrorBoundary>
  );
}
