'use client';

import dynamic from 'next/dynamic';

const SessionsPage = dynamic(() => import('@/views/SessionsPage').then((m) => m.SessionsPage), {
  ssr: false,
});

export default function Page() {
  return <SessionsPage />;
}
