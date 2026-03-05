import type { Metadata } from 'next';

import { AgentsPage } from '@/views/AgentsPage';

export const metadata: Metadata = { title: 'Agents' };

export default function Page() {
  return <AgentsPage />;
}
