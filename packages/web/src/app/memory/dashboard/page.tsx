import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Dashboard' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Dashboard"
      description="Dashboard metrics route and navigation exist now; visual dashboards arrive later."
    />
  );
}
