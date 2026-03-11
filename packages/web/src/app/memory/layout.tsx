import type { Metadata } from 'next';

import { MemorySidebar } from '@/components/memory/MemorySidebar';

export const metadata: Metadata = { title: 'Memory' };

export default function MemoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col md:flex-row">
      <MemorySidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
