import type { Metadata } from 'next';

import { MemorySynthesisPage } from '@/views/MemorySynthesisPage';

export const metadata: Metadata = { title: 'Memory Synthesis' };

export default function Page() {
  return <MemorySynthesisPage />;
}
