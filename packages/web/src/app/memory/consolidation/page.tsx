import type { Metadata } from 'next';

import { ConsolidationBoardView } from '@/views/ConsolidationBoardView';

export const metadata: Metadata = { title: 'Memory Consolidation' };

export default function Page() {
  return <ConsolidationBoardView />;
}
