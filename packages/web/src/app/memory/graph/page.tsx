import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Graph' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Graph"
      description="Graph visualization shell is in place; interactive graph views land in a later chunk."
    />
  );
}
