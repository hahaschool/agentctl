import type { Metadata } from 'next';

import { RuntimeSessionsPage } from '@/views/RuntimeSessionsPage';

export const metadata: Metadata = { title: 'Runtime Sessions' };

export default function Page() {
  return <RuntimeSessionsPage />;
}
