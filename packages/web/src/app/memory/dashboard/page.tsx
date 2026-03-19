import type { Metadata } from 'next';

import { MemoryDashboardView } from '@/views/MemoryDashboardView';

export const metadata: Metadata = { title: 'Memory Dashboard' };

export default function Page() {
  return <MemoryDashboardView />;
}
