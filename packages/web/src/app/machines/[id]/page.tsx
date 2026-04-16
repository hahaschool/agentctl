'use client';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MachineDetailView } from '@/views/MachineDetailView';

export default function MachineDetailPage() {
  return (
    <ErrorBoundary>
      <MachineDetailView />
    </ErrorBoundary>
  );
}
