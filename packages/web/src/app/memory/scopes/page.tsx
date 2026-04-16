import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemoryScopeManagerView } from '@/views/MemoryScopeManagerView';

export const metadata: Metadata = { title: 'Memory Scopes' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemoryScopeManagerView />
    </ErrorBoundary>
  );
}
