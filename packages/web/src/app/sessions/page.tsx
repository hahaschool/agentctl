import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SessionsPage } from '@/views/SessionsPage';

export const metadata: Metadata = { title: 'Sessions' };

export default function Page() {
  return (
    <ErrorBoundary>
      <SessionsPage />
    </ErrorBoundary>
  );
}
