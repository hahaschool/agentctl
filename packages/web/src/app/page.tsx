import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DashboardPage } from '@/views/DashboardPage';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Page() {
  return (
    <ErrorBoundary>
      <DashboardPage />
    </ErrorBoundary>
  );
}
