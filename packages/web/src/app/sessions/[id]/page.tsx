'use client';

import dynamic from 'next/dynamic';

const SessionDetailView = dynamic(
  () => import('@/views/SessionDetailView').then((m) => m.SessionDetailView),
  { ssr: false },
);

export default function SessionDetailPage() {
  return <SessionDetailView />;
}
