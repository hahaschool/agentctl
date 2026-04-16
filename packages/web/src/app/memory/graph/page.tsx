import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { KnowledgeGraphView } from '@/views/KnowledgeGraphView';

export const metadata: Metadata = { title: 'Memory Graph' };

export default function Page() {
  return (
    <ErrorBoundary>
      <KnowledgeGraphView />
    </ErrorBoundary>
  );
}
