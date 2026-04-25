import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryOperationsPage } from '@/views/MemoryOperationsPage';

export const metadata: Metadata = { title: 'Memory Operations' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryOperationsPage />
    </ErrorBoundary>
  );
}
