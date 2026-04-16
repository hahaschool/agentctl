'use client';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SessionDetailView } from '@/views/SessionDetailView';

export default function SessionDetailPage() {
  return (
    <ErrorBoundary>
      <SessionDetailView />
    </ErrorBoundary>
  );
}
