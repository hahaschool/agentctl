import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryDrawersView } from '@/views/MemoryDrawersView';

export const metadata: Metadata = { title: 'Memory Drawers' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryDrawersView />
    </ErrorBoundary>
  );
}
