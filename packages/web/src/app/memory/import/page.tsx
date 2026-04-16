import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryImportView } from '@/views/MemoryImportView';

export const metadata: Metadata = { title: 'Memory Import' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryImportView />
    </ErrorBoundary>
  );
}
