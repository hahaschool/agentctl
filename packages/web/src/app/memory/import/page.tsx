import type { Metadata } from 'next';

import { MemoryImportView } from '@/views/MemoryImportView';

export const metadata: Metadata = { title: 'Memory Import' };

export default function Page() {
  return <MemoryImportView />;
}
