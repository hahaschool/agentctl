import type { Metadata } from 'next';

import { MachinesPage } from '@/views/MachinesPage';

export const metadata: Metadata = { title: 'Machines' };

export default function Page() {
  return <MachinesPage />;
}
