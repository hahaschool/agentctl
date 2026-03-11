import type { Metadata } from 'next';

import { MemoryPlaceholderView } from '@/views/MemoryPlaceholderView';

export const metadata: Metadata = { title: 'Memory Scopes' };

export default function Page() {
  return (
    <MemoryPlaceholderView
      title="Memory Scopes"
      description="Scope inspection and management views are deferred; foundation only ships the route shell."
    />
  );
}
