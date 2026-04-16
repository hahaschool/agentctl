import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MemorySynthesisPage } from '@/views/MemorySynthesisPage';

export const metadata: Metadata = { title: 'Memory Synthesis' };

export default function Page() {
  return (
    <ErrorBoundary>
      <MemorySynthesisPage />
    </ErrorBoundary>
  );
}
