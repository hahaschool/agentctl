import type { Metadata } from 'next';

import { MemoryMaintenancePage } from '@/views/MemoryMaintenancePage';

export const metadata: Metadata = { title: 'Memory Maintenance' };

export default function Page() {
  return <MemoryMaintenancePage />;
}
