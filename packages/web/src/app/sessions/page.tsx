import type { Metadata } from 'next';

import { SessionsPage } from '@/views/SessionsPage';

export const metadata: Metadata = { title: 'Sessions' };

export default function Page() {
  return <SessionsPage />;
}
