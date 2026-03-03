'use client';

import dynamic from 'next/dynamic';

const LogsPage = dynamic(() => import('@/views/LogsPage').then((m) => m.LogsPage), {
  ssr: false,
});

export default function Page() {
  return <LogsPage />;
}
