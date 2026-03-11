import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Browser' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Browser"
      description="Fact browsing, search, and detail workflows arrive in the next implementation chunk."
    />
  );
}
