import type { Metadata } from 'next';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SettingsView } from '@/views/SettingsView';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <ErrorBoundary>
      <SettingsView />
    </ErrorBoundary>
  );
}
