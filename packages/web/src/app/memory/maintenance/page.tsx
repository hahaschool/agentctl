import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryMaintenancePage } from '@/views/MemoryMaintenancePage';

export const metadata: Metadata = { title: 'Memory Maintenance' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryMaintenancePage />
    </ErrorBoundary>
  );
}
