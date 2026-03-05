import type { Metadata } from 'next';

import { RouterConfigView } from '@/views/RouterConfigView';

export const metadata: Metadata = { title: 'Router Config' };

export default function RouterConfigPage() {
  return <RouterConfigView />;
}
