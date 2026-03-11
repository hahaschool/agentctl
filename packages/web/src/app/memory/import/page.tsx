import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Import' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Import"
      description="Import job tracking will land later; this route exists now so navigation can stabilize."
    />
  );
}
