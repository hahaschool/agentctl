> ⚠️ **ARCHIVED** — This plan has been fully implemented. Kept for historical reference.

# Next.js Migration Design

**Date:** 2026-03-03
**Status:** Plan
**Depends on:** `docs/plans/2026-03-03-frontend-framework-survey.md`

## 1. Decision & Rationale

The framework survey originally recommended Vite + TanStack Router as the best fit for an "internal admin tool." That recommendation was superseded after re-evaluating AgentCTL's positioning: the web dashboard is the **primary user interface** where users spend most of their time interacting with Claude Code agents. It is not a back-office admin panel -- it is the product.

This changes the calculus:

- **Perceived performance matters.** Server Components reduce the initial JS bundle. The dashboard currently ships all 6 page components in a single Vite bundle.
- **URL shareability matters.** SSR provides meaningful content at each URL instead of a blank shell that hydrates.
- **UI polish expectations are high.** The Next.js ecosystem (shadcn/ui, Tailwind, next-auth, next-themes) is the most mature and cohesive.
- **The app will grow.** Settings, auth, onboarding, and documentation pages are all planned. A full framework pays for itself over time.
- **API routes can absorb proxy logic.** Next.js API routes can proxy or aggregate control plane requests, simplifying the client.

**Framework:** Next.js 15+ with App Router (React Server Components, streaming, layouts, route groups).

## 2. Migration Strategy

**Approach:** Side-by-side. Create `packages/web-next/` alongside the existing `packages/web/`. Migrate page by page.

```
packages/
├── web/          # current Vite SPA (keep working until migration is complete)
├── web-next/     # new Next.js app (built incrementally)
└── shared/       # shared types, protocol definitions (unchanged)
```

**Rules:**
1. The existing `packages/web/` stays fully functional and deployable throughout the migration.
2. Each page is migrated independently. A page is "done" when it has feature parity with the old version plus any new improvements.
3. After all pages are migrated and tested, `packages/web/` is removed and `packages/web-next/` is renamed to `packages/web/`.
4. Shared types from `@agentctl/shared` are used in both packages during the transition.

## 3. Tech Stack

| Library | Purpose | Replaces |
|---------|---------|----------|
| Next.js 15 (App Router) | Framework, routing, SSR | Vite + `useState<Page>` routing |
| TanStack Query v5 | Server state, polling, caching | Custom `usePolling` hook |
| shadcn/ui + Radix | Component primitives | Inline-styled custom components |
| Tailwind CSS v4 | Utility-first styling | Inline `style={{}}` objects |
| Zustand | Minimal client state (WebSocket status, UI preferences) | `useState` scattered across pages |
| Sonner | Toast notifications | Custom `ToastProvider` |
| next-themes | Dark/light mode | CSS variable-only theming |
| nuqs | Type-safe URL search params (filters, sort, pagination) | `useState` for filter state |

### What We Keep
- `@agentctl/shared` types (`Agent`, `Machine`, `Session`, etc.) -- used as-is.
- `lib/format-utils.ts` -- migrated directly (pure functions, no framework dependency).
- `lib/api.ts` -- the `api` object and `ApiError` class migrate as-is, then get wrapped in TanStack Query hooks.
- WebSocket hook logic -- adapted into a Zustand store for global connection state.

## 4. Project Structure

```
packages/web-next/
├── app/
│   ├── layout.tsx              # root layout: providers, sidebar, global styles
│   ├── page.tsx                # dashboard (/)
│   ├── agents/
│   │   ├── page.tsx            # agents list (/agents)
│   │   └── [id]/
│   │       └── page.tsx        # agent detail (/agents/:id)
│   ├── sessions/
│   │   ├── page.tsx            # managed sessions list (/sessions)
│   │   └── [id]/
│   │       └── page.tsx        # session detail with live content (/sessions/:id)
│   ├── machines/
│   │   └── page.tsx            # fleet machines (/machines)
│   ├── discover/
│   │   └── page.tsx            # discover sessions across fleet (/discover)
│   ├── logs/
│   │   └── page.tsx            # logs & metrics (/logs)
│   └── settings/
│       ├── page.tsx            # general settings (/settings)
│       └── router/
│           └── page.tsx        # LiteLLM router config (/settings/router)
├── components/
│   ├── ui/                     # shadcn/ui primitives (Button, Badge, Card, etc.)
│   ├── layout/
│   │   ├── sidebar.tsx         # navigation sidebar
│   │   ├── header.tsx          # page header with breadcrumbs
│   │   └── mobile-nav.tsx      # responsive mobile navigation
│   └── shared/
│       ├── stat-card.tsx        # dashboard stat card
│       ├── status-badge.tsx     # status indicator dot + label
│       ├── copyable-text.tsx    # click-to-copy inline text
│       ├── session-preview.tsx  # session content slide-over panel
│       ├── empty-state.tsx      # reusable empty state placeholder
│       └── data-table.tsx       # generic TanStack Table wrapper
├── lib/
│   ├── api.ts                  # fetch wrapper + ApiError (migrated from current)
│   ├── queries.ts              # TanStack Query hooks (useHealth, useMachines, etc.)
│   ├── mutations.ts            # TanStack Mutation hooks (useCreateAgent, etc.)
│   ├── format-utils.ts         # timeAgo, formatCost, etc. (migrated directly)
│   ├── constants.ts            # polling intervals, route paths
│   └── utils.ts                # cn() helper, misc utilities
├── stores/
│   └── websocket-store.ts      # Zustand store for WebSocket connection + messages
├── styles/
│   └── globals.css             # Tailwind directives + CSS custom properties
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### Root Layout (`app/layout.tsx`)

The root layout wraps the entire app with providers and renders the persistent sidebar:

```tsx
// app/layout.tsx
import { Sidebar } from '@/components/layout/sidebar';
import { Providers } from './providers';
import '@/styles/globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-background">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
```

```tsx
// app/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark">
        {children}
        <Toaster position="bottom-right" richColors />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

## 5. Page Migration Map

| Current Page | Current File | Next.js Route | Key Changes |
|---|---|---|---|
| Dashboard | `pages/DashboardPage.tsx` | `app/page.tsx` | Replace `usePolling` with TanStack Query. Replace inline styles with Tailwind. |
| Machines | `pages/MachinesPage.tsx` | `app/machines/page.tsx` | Add machine detail route (`/machines/[id]`). Replace inline styles. |
| Agents | `pages/AgentsPage.tsx` | `app/agents/page.tsx` | Add agent detail route (`/agents/[id]`). Move create form to dialog. |
| Sessions | `pages/SessionsPage.tsx` | `app/sessions/page.tsx` | Move filter state to URL search params via `nuqs`. Add `/sessions/[id]` detail page. |
| Discover | `pages/DiscoverPage.tsx` | `app/discover/page.tsx` | Move filter/sort/group state to URL search params. Resume flow via dialog. |
| Logs | `pages/LogsPage.tsx` | `app/logs/page.tsx` | Replace metrics table with TanStack Table. Add auto-refresh toggle. |
| _(new)_ | -- | `app/settings/page.tsx` | General settings: theme, polling intervals, keyboard shortcut reference. |
| _(new)_ | -- | `app/settings/router/page.tsx` | LiteLLM router config: model list, health, failover. Uses `/api/router/*` endpoints. |

### Component Migration Map

| Current Component | Next.js Equivalent | Changes |
|---|---|---|
| `Sidebar.tsx` | `components/layout/sidebar.tsx` | Replace inline styles with Tailwind. Use `next/link` + `usePathname()` for active state. Keep keyboard shortcuts. |
| `StatCard.tsx` | `components/shared/stat-card.tsx` | Wrap with shadcn `Card`. Tailwind styling. |
| `StatusBadge.tsx` | `components/shared/status-badge.tsx` | Use shadcn `Badge` variant. Keep status color mapping. |
| `CopyableText.tsx` | `components/shared/copyable-text.tsx` | Minimal changes. Tailwind styling. |
| `SessionPreview.tsx` | `components/shared/session-preview.tsx` | Use shadcn `Sheet` (slide-over panel). Replace manual fetch with `useQuery`. |
| `Toast.tsx` (provider) | Replaced by Sonner | Remove entirely. Use `toast()` from Sonner. |

### Utility Migration Map

| Current File | Next.js Equivalent | Changes |
|---|---|---|
| `lib/api.ts` | `lib/api.ts` | Copy as-is. The `api` object and types remain identical. |
| `lib/format-utils.ts` | `lib/format-utils.ts` | Copy as-is. Pure functions, no dependencies. |
| `hooks/use-polling.ts` | Replaced by TanStack Query | Remove entirely. `refetchInterval` on `useQuery` replaces this. |
| `hooks/use-websocket.ts` | `stores/websocket-store.ts` | Convert to Zustand store for global access. Keep reconnect logic. |

## 6. New Features Enabled by Migration

### 6a. URL-Based State (Search Params)

Currently, all filter/sort/group state lives in `useState` and is lost on navigation or refresh. With `nuqs`, filter state moves to the URL:

```
/sessions?status=active&sort=newest&group=project
/discover?minMsgs=5&sort=recent&group=project&search=agentctl
/agents?status=running&sort=cost
```

This means filters survive page refresh, users can share filtered views via URL, and browser back/forward works with filter state.

### 6b. Deep-Linkable Detail Pages

Currently, there is no way to link directly to an agent or session. New routes:

```
/agents/abc123           # agent detail page
/sessions/def456         # session detail with live content stream
/machines/ghi789         # machine detail with capability info
```

### 6c. Settings Pages

Two new pages backed by existing control plane API routes:

**`/settings`** -- General configuration: theme preference (dark/light/system), default polling intervals, keyboard shortcut reference.

**`/settings/router`** -- LiteLLM router management: list available models (from `GET /api/router/models`), proxy health status (from `GET /api/router/health`), failover configuration, cost tracking overview.

### 6d. Responsive Layout

Replace the fixed 220px sidebar with a responsive layout:
- Desktop (>1024px): persistent sidebar + content
- Tablet (768-1024px): collapsible sidebar
- Mobile (<768px): bottom tab bar or hamburger menu

### 6e. Dark Mode Toggle

Replace CSS-variable-only theming with `next-themes` for proper dark/light/system mode support using Tailwind's `dark:` variant strategy.

## 7. Migration Steps (Phased)

### Phase 1: Scaffold + Layout + Dashboard

**Goal:** Next.js app boots, sidebar navigates, dashboard displays data.

1. `pnpm create next-app packages/web-next` with App Router, TypeScript, Tailwind, ESLint.
2. Install dependencies: `@tanstack/react-query`, `sonner`, `next-themes`, `nuqs`, `zustand`.
3. Run `npx shadcn@latest init` and add base components: `Button`, `Card`, `Badge`, `Input`, `Select`, `Sheet`, `Tooltip`.
4. Set up `app/layout.tsx` with `Providers`, `Sidebar`, and global styles.
5. Copy `lib/api.ts` and `lib/format-utils.ts` from `packages/web/src/lib/`.
6. Create `lib/queries.ts` with TanStack Query hooks:

```tsx
// lib/queries.ts
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 15_000,
  });
}

export function useMachines() {
  return useQuery({
    queryKey: ['machines'],
    queryFn: api.listMachines,
    refetchInterval: 15_000,
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: api.listAgents,
    refetchInterval: 10_000,
  });
}

export function useSessions(params?: { status?: string; machineId?: string }) {
  return useQuery({
    queryKey: ['sessions', params],
    queryFn: () => api.listSessions(params),
    refetchInterval: 5_000,
  });
}

export function useDiscoveredSessions() {
  return useQuery({
    queryKey: ['discovered-sessions'],
    queryFn: api.discoverSessions,
    refetchInterval: 30_000,
  });
}

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: api.metrics,
    refetchInterval: 15_000,
  });
}

export function useSessionContent(
  sessionId: string,
  params: { machineId: string; projectPath?: string; limit?: number },
) {
  return useQuery({
    queryKey: ['session-content', sessionId, params],
    queryFn: () => api.getSessionContent(sessionId, params),
    enabled: !!sessionId && !!params.machineId,
  });
}
```

7. Build `app/page.tsx` (Dashboard) using the query hooks and Tailwind.
8. Configure `next.config.ts` with API proxy rewrites for development:

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:8080/api/:path*' },
      { source: '/health', destination: 'http://localhost:8080/health' },
      { source: '/metrics', destination: 'http://localhost:8080/metrics' },
    ];
  },
};

export default nextConfig;
```

9. Add `packages/web-next` to pnpm workspace in root `pnpm-workspace.yaml`.
10. Verify: dashboard loads, stats populate, auto-refresh works.

**Deliverable:** Working dashboard at `localhost:3000` with sidebar navigation (other pages show placeholder content).

### Phase 2: Sessions + Discover Pages

**Goal:** Migrate the two most complex pages. These exercise filtering, search params, session content preview, and mutations.

1. Build `app/sessions/page.tsx`:
   - Move status/search/sort/group state to URL search params via `nuqs`.
   - Replace `usePolling` with `useSessions()`.
   - Replace inline create form with shadcn `Dialog`.
   - Add mutation hooks for create/resume/delete/send-message.
2. Build `app/sessions/[id]/page.tsx`:
   - Full session detail view using `useSessionContent()`.
   - Message list with tool call expand/collapse.
   - Send message input at the bottom.
3. Build `app/discover/page.tsx`:
   - Project grouping with collapsible groups.
   - Resume flow via inline input or dialog.
   - Session preview via shadcn `Sheet` (right slide-over).
4. Create WebSocket Zustand store (`stores/websocket-store.ts`):

```tsx
// stores/websocket-store.ts
import { create } from 'zustand';

type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type WebSocketStore = {
  status: WsConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  send: (message: Record<string, unknown>) => void;
  subscribe: (callback: (message: Record<string, unknown>) => void) => () => void;
};

export const useWebSocketStore = create<WebSocketStore>((set) => {
  let ws: WebSocket | null = null;
  const listeners = new Set<(msg: Record<string, unknown>) => void>();

  return {
    status: 'disconnected',
    connect: () => {
      // Reconnect logic ported from current hooks/use-websocket.ts
      // Exponential backoff with jitter, visibility-based pause/resume
    },
    disconnect: () => {
      ws?.close();
      ws = null;
      set({ status: 'disconnected' });
    },
    send: (message) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    subscribe: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
});
```

5. Integrate WebSocket store with TanStack Query: on `agent_event` messages, call `queryClient.invalidateQueries()` for real-time cache updates.

**Deliverable:** Sessions and Discover pages fully functional with URL-persisted filters and session detail routes.

### Phase 3: Agents + Machines Pages

**Goal:** Migrate agent management and fleet overview.

1. Build `app/agents/page.tsx`:
   - Agent cards grid with filter/sort controls.
   - Create agent form via `Dialog`.
   - Start/stop actions via `useMutation`.
2. Build `app/agents/[id]/page.tsx`:
   - Agent detail: config, run history, cost breakdown.
   - Live status via WebSocket store subscription.
3. Build `app/machines/page.tsx`:
   - Machine cards with capability badges.
   - Filter by status.
4. Build shared `DataTable` component using TanStack Table for the Logs page worker health table (reusable across pages).

**Deliverable:** Full agent and machine management with detail pages.

### Phase 4: Logs + Settings Pages

**Goal:** Migrate the last existing page and add new settings pages.

1. Build `app/logs/page.tsx`:
   - System health section with dependency cards.
   - Metrics display with auto-refresh toggle.
   - Worker health table via `DataTable` component.
   - Raw metrics collapsible section.
2. Build `app/settings/page.tsx`:
   - Theme toggle (dark/light/system).
   - Polling interval preferences.
   - Keyboard shortcuts reference card.
3. Build `app/settings/router/page.tsx`:
   - LiteLLM proxy health (from `GET /api/router/health`).
   - Available models list (from `GET /api/router/models`).
   - Model routing configuration.

**Deliverable:** All pages migrated. Settings pages are new.

### Phase 5: Cleanup + Swap

**Goal:** Remove old package, finalize.

1. Run both `packages/web` and `packages/web-next` side by side. Verify feature parity for every page.
2. Update deployment scripts, Docker configs, or PM2 ecosystem files that reference `packages/web`.
3. Remove `packages/web/`.
4. Rename `packages/web-next/` to `packages/web/`.
5. Update `pnpm-workspace.yaml` and root `package.json`.
6. Update `CLAUDE.md` project structure section.

## 8. API Integration

### TanStack Query Conventions

All server state flows through TanStack Query.

**Query key structure:**
```ts
['health']                              // singleton resources
['machines']                            // list resources
['agents']                              // list resources
['agents', agentId]                     // detail resources
['sessions', { status, machineId }]     // list with filter params
['session-content', sessionId, params]  // nested detail
```

**Polling intervals** (matching current `usePolling` intervals):
```ts
const INTERVALS = {
  health: 15_000,
  machines: 15_000,
  agents: 10_000,
  sessions: 5_000,
  discover: 30_000,
  metrics: 15_000,
} as const;
```

**Mutations** use `useMutation` with `onSuccess` invalidation:

```tsx
// lib/mutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create agent');
    },
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) =>
      api.startAgent(id, prompt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Agent started');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start agent');
    },
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.stopAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent stopped');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to stop agent');
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['discovered-sessions'] });
      toast.success('Session created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create session');
    },
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      api.sendMessage(id, message),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['session-content', id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    },
  });
}
```

### WebSocket + Query Cache Integration

When a WebSocket `agent_event` message arrives, invalidate relevant queries so the UI refreshes without waiting for the next polling cycle:

```tsx
// In a client component that initializes the WebSocket:
const queryClient = useQueryClient();

useEffect(() => {
  const unsubscribe = useWebSocketStore.getState().subscribe((message) => {
    if (message.type === 'agent_event') {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  });
  return unsubscribe;
}, [queryClient]);
```

### Error Handling Pattern

The existing `ApiError` class is preserved. TanStack Query surfaces errors via the `error` field:

```tsx
'use client';

import { useHealth } from '@/lib/queries';

export function HealthStatus() {
  const { data, error, isLoading } = useHealth();

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
        {error.message}
      </div>
    );
  }

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  return <HealthCard status={data.status} timestamp={data.timestamp} />;
}
```

## 9. Development Workflow

### Running During Migration

Both apps run simultaneously:

```bash
# Terminal 1: Control plane backend
cd packages/control-plane && pnpm dev    # localhost:8080

# Terminal 2: Old Vite SPA (still works)
cd packages/web && pnpm dev              # localhost:5173

# Terminal 3: New Next.js app
cd packages/web-next && pnpm dev         # localhost:3000
```

Both frontends proxy `/api/*` to `localhost:8080`, so they share the same backend.

### Package Dependencies

```json
{
  "name": "@agentctl/web-next",
  "dependencies": {
    "@agentctl/shared": "workspace:*",
    "@tanstack/react-query": "^5",
    "next": "^15",
    "next-themes": "^0.4",
    "nuqs": "^2",
    "react": "^19",
    "react-dom": "^19",
    "sonner": "^2",
    "zustand": "^5"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5.7"
  }
}
```

### Testing

- Unit tests: Vitest (consistent with the rest of the monorepo).
- Component tests: Vitest + Testing Library.
- E2E tests: Playwright (deferred to after migration is complete).
- Query hook tests: Use `@tanstack/react-query` test utilities with mock `queryClient`.

## 10. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Next.js overhead for a behind-auth tool | Use `'use client'` on all interactive pages. RSC benefits still apply for layout and initial load. |
| Tailwind migration is tedious | Migrate one page at a time. Do not attempt to convert all inline styles at once. |
| WebSocket handling in Next.js | WebSocket connections only in client components. Zustand store isolates this. |
| Two packages running during migration | Both proxy to the same backend. No data conflicts. |
| Breaking changes in Next.js 15 | Pin to a specific minor version. Avoid experimental features. |

## 11. Definition of Done

The migration is complete when:

1. All 6 existing pages are migrated with feature parity.
2. Settings pages (`/settings`, `/settings/router`) are functional.
3. URL-based routing works (deep links, back/forward, refresh preserves state).
4. Filter/sort state is persisted in URL search params.
5. WebSocket real-time updates work.
6. Dark mode toggle works.
7. Responsive layout works on tablet widths.
8. `packages/web/` is removed and `packages/web-next/` is the sole frontend.
9. All existing backend API endpoints are consumed correctly.
10. Biome formatting passes on all files.
