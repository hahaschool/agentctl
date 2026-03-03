'use client';

import dynamic from 'next/dynamic';

const MachineDetailView = dynamic(
  () => import('@/views/MachineDetailView').then((m) => m.MachineDetailView),
  { ssr: false },
);

export default function MachineDetailPage() {
  return <MachineDetailView />;
}
