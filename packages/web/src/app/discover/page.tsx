import type { Metadata } from 'next';

import { DiscoverPage } from '@/views/DiscoverPage';

export const metadata: Metadata = { title: 'Discover' };

export default function Page() {
  return <DiscoverPage />;
}
