import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Consolidation' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Consolidation"
      description="Consolidation review UI is intentionally deferred; this chunk only adds the route shell."
    />
  );
}
