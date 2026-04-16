import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryDashboardView } from '@/views/MemoryDashboardView';

export const metadata: Metadata = { title: 'Memory Dashboard' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryDashboardView />
    </ErrorBoundary>
  );
}
