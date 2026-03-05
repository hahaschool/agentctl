import type { Metadata } from 'next';

import { LogsPage } from '@/views/LogsPage';

export const metadata: Metadata = { title: 'Logs & Metrics' };

export default function Page() {
  return <LogsPage />;
}
