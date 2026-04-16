import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RouterConfigView } from '@/views/RouterConfigView';

export const metadata: Metadata = { title: 'Router Config' };

export default function RouterConfigPage() {
  return (
    <ErrorBoundary>
      <RouterConfigView />
    </ErrorBoundary>
  );
}
