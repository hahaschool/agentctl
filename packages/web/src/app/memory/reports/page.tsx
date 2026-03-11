import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Reports' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Reports"
      description="Report browsing and generation workflows are out of scope for the foundation chunk."
    />
  );
}
