import type { Metadata } from 'next';

import { Sidebar } from '@/components/Sidebar';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'AgentCTL',
  description: 'Multi-Machine AI Agent Orchestration Platform',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x2699;</text></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-full bg-background text-foreground antialiased">
        <Providers>
          <div className="h-full flex">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-background">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
