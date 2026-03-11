import type { Metadata } from 'next';

import { KnowledgeGraphView } from '@/views/KnowledgeGraphView';

export const metadata: Metadata = { title: 'Memory Graph' };

export default function Page() {
  return <KnowledgeGraphView />;
}
