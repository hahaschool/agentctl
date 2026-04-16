import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConsolidationBoardView } from '@/views/ConsolidationBoardView';

export const metadata: Metadata = { title: 'Memory Consolidation' };

export default function Page() {
  return (
    <ErrorBoundary>
      <ConsolidationBoardView />
    </ErrorBoundary>
  );
}
