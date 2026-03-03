'use client';

import dynamic from 'next/dynamic';

const DiscoverPage = dynamic(() => import('@/views/DiscoverPage').then((m) => m.DiscoverPage), {
  ssr: false,
});

export default function Page() {
  return <DiscoverPage />;
}
