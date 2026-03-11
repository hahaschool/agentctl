import type { Metadata } from 'next';

import { MemoryScopeManagerView } from '@/views/MemoryScopeManagerView';

export const metadata: Metadata = { title: 'Memory Scopes' };

export default function Page() {
  return <MemoryScopeManagerView />;
}
