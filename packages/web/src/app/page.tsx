'use client';

import dynamic from 'next/dynamic';

const DashboardPage = dynamic(() => import('@/views/DashboardPage').then((m) => m.DashboardPage), {
  ssr: false,
});

export default function Page() {
  return <DashboardPage />;
}
