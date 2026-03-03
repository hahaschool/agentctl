import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Logs & Metrics' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
