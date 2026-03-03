'use client';

import dynamic from 'next/dynamic';

const AgentsPage = dynamic(() => import('@/views/AgentsPage').then((m) => m.AgentsPage), {
  ssr: false,
});

export default function Page() {
  return <AgentsPage />;
}
