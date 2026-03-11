import type { Metadata } from 'next';

import { MemoryReportsView } from '@/views/MemoryReportsView';

export const metadata: Metadata = { title: 'Memory Reports' };

export default function Page() {
  return <MemoryReportsView />;
}
