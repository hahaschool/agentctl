import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AgentsPage } from '@/views/AgentsPage';

export const metadata: Metadata = { title: 'Agents' };

export default function Page() {
  return (
    <ErrorBoundary>
      <AgentsPage />
    </ErrorBoundary>
  );
}
