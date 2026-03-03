'use client';

import dynamic from 'next/dynamic';

const RouterConfigView = dynamic(
  () => import('@/views/RouterConfigView').then((m) => m.RouterConfigView),
  { ssr: false },
);

export default function RouterConfigPage() {
  return <RouterConfigView />;
}
