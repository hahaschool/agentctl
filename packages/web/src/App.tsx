import { useState } from 'react';

import type { Page } from './components/Sidebar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { AgentsPage } from './pages/AgentsPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { DiscoverPage } from './pages/DiscoverPage.tsx';
import { LogsPage } from './pages/LogsPage.tsx';
import { MachinesPage } from './pages/MachinesPage.tsx';
import { SessionsPage } from './pages/SessionsPage.tsx';

const PAGE_COMPONENTS: Record<Page, () => React.JSX.Element> = {
  dashboard: DashboardPage,
  machines: MachinesPage,
  agents: AgentsPage,
  sessions: SessionsPage,
  discover: DiscoverPage,
  logs: LogsPage,
};

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard');
  const PageComponent = PAGE_COMPONENTS[page];

  return (
    <>
      <Sidebar activePage={page} onNavigate={setPage} />
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <PageComponent />
      </main>
    </>
  );
}
