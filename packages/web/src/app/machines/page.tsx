'use client';

import dynamic from 'next/dynamic';

const MachinesPage = dynamic(() => import('@/views/MachinesPage').then((m) => m.MachinesPage), {
  ssr: false,
});

export default function Page() {
  return <MachinesPage />;
}
