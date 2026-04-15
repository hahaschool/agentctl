import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LogsPage } from '@/views/LogsPage';

export const metadata: Metadata = { title: 'Logs & Metrics' };

export default function Page() {
  return (
    <ErrorBoundary>
      <LogsPage />
    </ErrorBoundary>
  );
}
