import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Deployment' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
