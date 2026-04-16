import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryReportsView } from '@/views/MemoryReportsView';

export const metadata: Metadata = { title: 'Memory Reports' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryReportsView />
    </ErrorBoundary>
  );
}
