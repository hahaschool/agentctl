# Next.js App Router Migration Design

**Date:** 2026-03-03
**Status:** Draft
**Author:** AgentCTL Team

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Tech Stack](#3-target-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Data Fetching Strategy](#5-data-fetching-strategy)
6. [Real-Time Architecture](#6-real-time-architecture)
7. [Component Migration Plan](#7-component-migration-plan)
8. [Styling Migration](#8-styling-migration)
9. [Monorepo Integration](#9-monorepo-integration)
10. [Migration Phases](#10-migration-phases)
11. [Risk Assessment](#11-risk-assessment)
12. [References](#12-references)

---

## 1. Executive Summary

This document describes the migration of `packages/web` from a plain Vite + React 19 SPA (single-page application with `useState`-based routing) to a Next.js 15+ App Router application with TanStack Query, Tailwind CSS v4, and shadcn/ui.

**Why migrate:**

- **No real routing.** The current app uses `useState<Page>` in `App.tsx` to switch between 6 pages. There are no URLs, no browser back/forward, no deep linking, no shareable links. Users cannot bookmark `/sessions/abc-123` or share a link to a specific agent.
- **No code splitting.** All 6 pages and their dependencies are bundled into a single JavaScript file. The Dashboard page loads the entire Sessions page code even if the user never visits it.
- **Inline styles everywhere.** Every component uses `style={{...}}` objects, making the codebase verbose (the `DashboardPage` alone is 616 lines), difficult to maintain, and impossible to achieve design consistency.
- **Custom data fetching hooks with no caching.** The `usePolling` hook refetches on every interval without caching, deduplication, or stale-while-revalidate. Navigating away and back refetches everything from scratch.
- **Custom toast system.** The `ToastProvider` context is a ~170-line hand-rolled implementation that could be replaced with Sonner (battle-tested, accessible, 3KB).
- **This is the primary user interface.** Users spend most of their time here interacting with Claude Code agents. It must feel polished and performant.

**What we gain:**

- File-system routing with deep linking and URL-based state
- Automatic code splitting per route
- Server Components for initial data loading (no loading spinners on first paint)
- TanStack Query for intelligent caching, background refetching, and optimistic updates
- Tailwind CSS v4 + shadcn/ui for a design system with consistent spacing, colors, and accessibility
- TanStack Table for sortable, filterable data tables (replacing hand-rolled table/grid code)
- Proper dark/light mode support via `next-themes`

---

## 2. Current State Analysis

### 2.1 File Inventory

```
packages/web/
  src/
    App.tsx                          # useState-based page router (39 lines)
    main.tsx                         # ReactDOM.createRoot entry (15 lines)
    index.css                        # CSS variables, reset, scrollbar styles (135 lines)
    vite-env.d.ts
    pages/
      DashboardPage.tsx              # 616 lines, 5 usePolling calls, inline styles
      MachinesPage.tsx               # 485 lines, 1 usePolling, search/filter, inline styles
      AgentsPage.tsx                 # 789 lines, 2 usePolling, create/start/stop, inline styles
      SessionsPage.tsx               # ~1000+ lines, create/send/delete, inline detail panel
      DiscoverPage.tsx               # 985 lines, grouping/filtering, resume, inline styles
      LogsPage.tsx                   # 445 lines, health/metrics/worker table, inline styles
    components/
      Sidebar.tsx                    # 190 lines, keyboard shortcuts, inline styles
      StatusBadge.tsx                # 61 lines, status-to-color mapping
      StatCard.tsx                   # 38 lines, label/value/color card
      CopyableText.tsx               # 72 lines, click-to-copy with feedback
      SessionPreview.tsx             # 436 lines, slide-in panel, message bubbles
      Toast.tsx                      # 168 lines, context-based toast system
    hooks/
      use-polling.ts                 # 83 lines, interval + visibility change
      use-websocket.ts               # 257 lines, auto-reconnect with jitter
    lib/
      api.ts                         # 213 lines, fetch wrapper, type definitions
      format-utils.ts                # 110 lines, timeAgo, formatDate, shortenPath, etc.
```

### 2.2 Key Patterns to Preserve

- **Keyboard shortcuts** (1-6 for page navigation) -- will map to `useHotkeys` or similar
- **Polling with visibility-change pause/resume** -- TanStack Query handles this natively
- **WebSocket with exponential backoff reconnection** -- will keep, adapted for App Router
- **API client structure** (`api.health()`, `api.listMachines()`, etc.) -- will keep, wrap in query functions
- **Session preview slide-in panel** -- will become a proper route or parallel route
- **Status badge color mapping** -- will become a shadcn/ui Badge variant

### 2.3 Pain Points to Fix

| Problem | Current | After Migration |
|---------|---------|----------------|
| No URLs | `useState<Page>` | File-system routes with `<Link>` |
| No code splitting | Single bundle | Automatic per-route splitting |
| No caching | `usePolling` refetches from scratch | TanStack Query with stale-while-revalidate |
| Verbose inline styles | `style={{padding: 24, maxWidth: 1100}}` | `className="p-6 max-w-5xl"` |
| Inaccessible components | No ARIA attributes | shadcn/ui (Radix primitives) |
| No loading states | Boolean `isLoading` + inline div | `<Suspense>` + skeleton components |
| Hand-rolled tables | `<table>` with `thStyle`/`tdStyle` | TanStack Table with sorting/filtering |
| No error boundaries | `{error && <div>...}` | `error.tsx` route-level error boundaries |

---

## 3. Target Tech Stack

### 3.1 Core Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | `^15.2` | App Router, file-system routing, Server Components |
| `react` | `^19.0` | Keep existing React 19 (Next.js 15 requires it) |
| `react-dom` | `^19.0` | Keep existing |

### 3.2 Data Layer

| Package | Version | Purpose |
|---------|---------|---------|
| `@tanstack/react-query` | `^5.62` | Data fetching, caching, background refetching |
| `@tanstack/react-table` | `^8.21` | Sortable, filterable data tables |

### 3.3 Styling

| Package | Version | Purpose |
|---------|---------|---------|
| `tailwindcss` | `^4.0` | Utility-first CSS (CSS-first config, no JS config file) |
| `@tailwindcss/postcss` | `^4.0` | PostCSS integration for Next.js |
| `next-themes` | `^0.4` | Dark/light mode with system preference |
| `class-variance-authority` | `^0.7` | Variant-based component styling (used by shadcn/ui) |
| `clsx` | `^2.1` | Conditional class merging |
| `tailwind-merge` | `^3.0` | Intelligent Tailwind class merging |
| `lucide-react` | `^0.468` | Icon library (shadcn/ui default) |

shadcn/ui is not installed as a package -- it is a CLI that copies component source files into the project. We will use:

```bash
npx shadcn@latest init
npx shadcn@latest add button card badge table dialog sheet input select tabs toast separator skeleton dropdown-menu command
```

### 3.4 Toast

| Package | Version | Purpose |
|---------|---------|---------|
| `sonner` | `^2.0` | Toast notifications (shadcn/ui recommended, replaces custom Toast.tsx) |

### 3.5 Development

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | `^5.7` | Keep existing version |
| `@biomejs/biome` | `^2.4` | Keep existing (monorepo root) |

---

## 4. Project Structure

### 4.1 Migration Strategy: Replace In-Place

We will **replace `packages/web` in-place** rather than creating a parallel `packages/web-next`. Reasons:

1. The current app has zero tests, no consumers of its exports, and no CI/CD pipeline that depends on its build output. There is nothing to break.
2. A parallel package creates confusion about which one to develop in, and doubles the maintenance burden during migration.
3. The pnpm workspace name (`@agentctl/web`) and the Vite dev proxy configuration on port 5173 can be preserved.

The migration will happen on a `feat/nextjs-migration` branch. The old Vite app remains available on `main` until the branch is merged.

### 4.2 New Directory Structure

```
packages/web/
  next.config.ts                     # Next.js configuration
  postcss.config.mjs                 # PostCSS with @tailwindcss/postcss
  tsconfig.json                      # Updated for Next.js
  package.json                       # Updated dependencies
  components.json                    # shadcn/ui configuration
  public/
    favicon.ico
  src/
    app/
      layout.tsx                     # Root layout: providers, sidebar, theme
      page.tsx                       # Dashboard (/)
      loading.tsx                    # Root loading skeleton
      error.tsx                      # Root error boundary
      not-found.tsx                  # 404 page
      globals.css                    # Tailwind imports + theme variables
      machines/
        page.tsx                     # Fleet machines (/machines)
        loading.tsx
      agents/
        page.tsx                     # Agent management (/agents)
        loading.tsx
      sessions/
        page.tsx                     # Session list (/sessions)
        loading.tsx
        [id]/
          page.tsx                   # Session detail (/sessions/abc-123)
          loading.tsx
      discover/
        page.tsx                     # Session discovery (/discover)
        loading.tsx
      logs/
        page.tsx                     # Log viewer (/logs)
        loading.tsx
      settings/
        page.tsx                     # Settings overview (/settings) [NEW]
        layout.tsx                   # Settings sub-layout with tabs
        router/
          page.tsx                   # LiteLLM router config (/settings/router) [NEW]
    components/
      ui/                            # shadcn/ui components (auto-generated)
        button.tsx
        badge.tsx
        card.tsx
        table.tsx
        dialog.tsx
        sheet.tsx
        input.tsx
        select.tsx
        tabs.tsx
        skeleton.tsx
        separator.tsx
        dropdown-menu.tsx
        command.tsx
      layout/
        sidebar.tsx                  # Sidebar navigation (migrated)
        header.tsx                   # Page header with breadcrumbs
        theme-toggle.tsx             # Dark/light mode toggle
      data-display/
        status-badge.tsx             # Status indicator (migrated to Badge variant)
        stat-card.tsx                # Stat card (migrated to Card)
        copyable-text.tsx            # Click-to-copy (migrated)
        session-preview.tsx          # Session preview sheet (migrated to Sheet)
        message-bubble.tsx           # Chat message display (extracted from SessionPreview)
      tables/
        machines-table.tsx           # TanStack Table for machines
        agents-table.tsx             # TanStack Table for agents
        sessions-table.tsx           # TanStack Table for sessions
        workers-table.tsx            # TanStack Table for worker health
      forms/
        create-agent-form.tsx        # Agent creation form (extracted from AgentsPage)
        create-session-form.tsx      # Session creation form (extracted from SessionsPage)
        prompt-input.tsx             # Reusable prompt input with send button
      real-time/
        ws-status-indicator.tsx      # WebSocket connection status dot
        agent-event-stream.tsx       # SSE-based agent output display
    hooks/
      use-websocket.ts              # WebSocket hook (migrated, remove import.meta.env.DEV)
      use-hotkeys.ts                # Keyboard shortcut hook
    lib/
      api.ts                         # API client (migrated, kept mostly as-is)
      format-utils.ts                # Formatting utilities (kept as-is)
      query-keys.ts                  # TanStack Query key factory
      query-functions.ts             # Query function wrappers
      utils.ts                       # cn() helper for Tailwind class merging
    providers/
      query-provider.tsx             # TanStack Query provider ("use client")
      theme-provider.tsx             # next-themes provider ("use client")
```

### 4.3 Route Map

| Route | Page | Data Requirements | Rendering |
|-------|------|-------------------|-----------|
| `/` | Dashboard | health, metrics, machines, agents, discovered sessions | Client (polling) |
| `/machines` | Fleet Machines | machines list | Client (polling + search/filter) |
| `/agents` | Agent Management | agents list, machines list | Client (interactive) |
| `/sessions` | Session List | sessions list | Client (polling, 5s interval) |
| `/sessions/[id]` | Session Detail | session by ID, session content | Client (real-time SSE) |
| `/discover` | Discover Sessions | discovered sessions | Client (polling) |
| `/logs` | Logs & Metrics | health, metrics, machines | Client (polling) |
| `/settings` | Settings | config (new API) | Server + Client |
| `/settings/router` | LiteLLM Router Config | router models (existing API) | Server + Client |

---

## 5. Data Fetching Strategy

### 5.1 TanStack Query Setup

Create a query client with sensible defaults:

```typescript
// src/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is fresh for 30 seconds -- don't refetch during this window
        staleTime: 30 * 1000,
        // Keep unused data in cache for 5 minutes
        gcTime: 5 * 60 * 1000,
        // Retry failed requests 2 times with exponential backoff
        retry: 2,
        // Refetch when the window regains focus (replaces visibility-change logic)
        refetchOnWindowFocus: true,
      },
    },
  });
}
```

Create a client-side provider:

```typescript
// src/providers/query-provider.tsx
'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

import { makeQueryClient } from '@/lib/query-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState ensures one QueryClient per component lifecycle
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### 5.2 Query Key Factory

Centralized query keys prevent key collisions and enable targeted invalidation:

```typescript
// src/lib/query-keys.ts
export const queryKeys = {
  health: ['health'] as const,
  metrics: ['metrics'] as const,
  machines: {
    all: ['machines'] as const,
    detail: (id: string) => ['machines', id] as const,
  },
  agents: {
    all: ['agents'] as const,
    detail: (id: string) => ['agents', id] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    list: (params?: { status?: string; machineId?: string }) =>
      ['sessions', 'list', params] as const,
    detail: (id: string) => ['sessions', id] as const,
    content: (id: string, machineId: string) =>
      ['sessions', id, 'content', machineId] as const,
  },
  discover: ['discover'] as const,
} as const;
```

### 5.3 Query Function Wrappers

Wrap the existing `api` module in query-compatible functions:

```typescript
// src/lib/query-functions.ts
import { queryOptions } from '@tanstack/react-query';

import { api } from './api';
import { queryKeys } from './query-keys';

export const healthQuery = queryOptions({
  queryKey: queryKeys.health,
  queryFn: api.health,
  refetchInterval: 15_000,
});

export const metricsQuery = queryOptions({
  queryKey: queryKeys.metrics,
  queryFn: api.metrics,
  refetchInterval: 15_000,
});

export const machinesQuery = queryOptions({
  queryKey: queryKeys.machines.all,
  queryFn: api.listMachines,
  refetchInterval: 15_000,
});

export const agentsQuery = queryOptions({
  queryKey: queryKeys.agents.all,
  queryFn: api.listAgents,
  refetchInterval: 10_000,
});

export const sessionsQuery = queryOptions({
  queryKey: queryKeys.sessions.all,
  queryFn: () => api.listSessions(),
  refetchInterval: 5_000,
});

export const discoverQuery = queryOptions({
  queryKey: queryKeys.discover,
  queryFn: api.discoverSessions,
  refetchInterval: 30_000,
});

export function sessionContentQuery(sessionId: string, machineId: string, projectPath?: string) {
  return queryOptions({
    queryKey: queryKeys.sessions.content(sessionId, machineId),
    queryFn: () =>
      api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: 200,
      }),
    staleTime: 10_000,
  });
}
```

### 5.4 Replacing `usePolling` with TanStack Query

Before (current):

```typescript
const machines = usePolling<Machine[]>({
  fetcher: api.listMachines,
  intervalMs: 15_000,
});

// Usage:
machines.data       // Machine[] | null
machines.error       // Error | null
machines.isLoading   // boolean
machines.refresh()   // manual refetch
```

After (TanStack Query):

```typescript
const machines = useQuery(machinesQuery);

// Usage:
machines.data        // Machine[] | undefined
machines.error       // Error | null
machines.isLoading   // boolean (first load only)
machines.isPending   // boolean (no data yet)
machines.isFetching  // boolean (any fetch, including background)
machines.refetch()   // manual refetch
```

Key differences:
- `data` is `undefined` instead of `null` when not yet loaded -- use `??` operator as before
- `isLoading` is only true on the first fetch. Use `isFetching` for all fetches including background refetches.
- Visibility-change pause/resume is handled automatically via `refetchOnWindowFocus`
- Data persists in cache across route navigations -- navigating away and back shows cached data instantly while refetching in background

### 5.5 Mutations

For create/update/delete operations, use `useMutation` with cache invalidation:

```typescript
// Example: Create agent
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { name: string; machineId: string; type: string }) =>
      api.createAgent(body),
    onSuccess: () => {
      // Invalidate agents list to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

// Usage in component:
const createAgent = useCreateAgent();
createAgent.mutate({ name: 'my-agent', machineId: 'abc', type: 'autonomous' });
// createAgent.isPending, createAgent.isError, createAgent.error available
```

### 5.6 Server Components vs Client Components

**Server Components** (default in App Router -- no `'use client'` directive):
- `src/app/layout.tsx` -- renders the HTML shell, sidebar structure
- `src/app/not-found.tsx` -- static 404 page
- `src/app/settings/page.tsx` -- initial settings render
- Any component that does not use hooks, browser APIs, or event handlers

**Client Components** (must add `'use client'` at top):
- All page components that use `useQuery` (Dashboard, Machines, Agents, Sessions, Discover, Logs)
- All interactive components (forms, buttons with onClick, search inputs)
- Sidebar (uses keyboard event listeners)
- Session preview panel (uses scroll refs, WebSocket)
- Toast provider (uses context)
- Theme provider (uses `next-themes`)

**Practical implication:** Nearly all pages in AgentCTL are highly interactive with polling data, so they will be Client Components. This is fine and expected -- the App Router still provides routing, code splitting, and layout nesting even when pages are Client Components. The value of Server Components here is primarily in the layout shell and any future static pages (docs, settings).

The pattern for each page will be:

```typescript
// src/app/machines/page.tsx
import { MachinesPageContent } from './machines-page-content';

// This is a Server Component -- it defines the route and renders metadata
export const metadata = {
  title: 'Machines | AgentCTL',
};

export default function MachinesPage() {
  return <MachinesPageContent />;
}
```

```typescript
// src/app/machines/machines-page-content.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { machinesQuery } from '@/lib/query-functions';
// ... actual interactive page content
```

---

## 6. Real-Time Architecture

### 6.1 WebSocket Strategy

The existing `useWebSocket` hook is well-designed with exponential backoff reconnection, ref-based callback management, and proper cleanup. It will be migrated with minimal changes.

**Changes needed:**
- Replace `import.meta.env.DEV` with `process.env.NODE_ENV === 'development'` (Next.js convention)
- The WebSocket URL resolution already handles production vs development correctly
- Next.js App Router does not natively support WebSocket in Route Handlers for Vercel deployments. Since AgentCTL is self-hosted on the Tailscale mesh (not Vercel), this is not a limitation -- the WebSocket connects directly to the control-plane backend at `localhost:8080/api/ws` (in dev) or via reverse proxy (in production).

**No changes to the control-plane backend are required.** The Next.js app connects to the same WebSocket endpoint.

### 6.2 SSE for Agent Output Streaming

For the session detail page (`/sessions/[id]`), agent output should stream in real-time via SSE. The control-plane already has SSE support via `packages/control-plane/src/api/routes/stream.ts`.

Client-side SSE consumption in the session detail page:

```typescript
// src/hooks/use-sse-stream.ts
'use client';

import { useEffect, useRef, useState } from 'react';

type UseSSEStreamOptions = {
  url: string;
  enabled?: boolean;
  onMessage?: (event: MessageEvent) => void;
};

export function useSSEStream({ url, enabled = true, onMessage }: UseSSEStreamOptions) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (event) => onMessageRef.current?.(event);
    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects by default
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [url, enabled]);

  return { connected };
}
```

### 6.3 Proxy Configuration

In development, Next.js needs to proxy API requests to the control-plane backend. Use `next.config.ts` rewrites:

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8080/api/:path*',
      },
      {
        source: '/health',
        destination: 'http://localhost:8080/health',
      },
      {
        source: '/metrics',
        destination: 'http://localhost:8080/metrics',
      },
    ];
  },
  // Transpile the shared package from the monorepo
  transpilePackages: ['@agentctl/shared'],
};

export default nextConfig;
```

---

## 7. Component Migration Plan

### 7.1 Sidebar -> `src/components/layout/sidebar.tsx`

The Sidebar becomes a persistent layout component rendered in `app/layout.tsx`. Key changes:

- Replace `onNavigate(page)` callback with Next.js `<Link href="/machines">` elements
- Replace `activePage === item.key` check with `usePathname()` hook
- Replace inline styles with Tailwind classes
- Keep keyboard shortcuts via a `useHotkeys` hook that calls `router.push()`

```typescript
// src/components/layout/sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: 'LayoutDashboard', shortcut: '1' },
  { href: '/machines', label: 'Machines', icon: 'Server', shortcut: '2' },
  { href: '/agents', label: 'Agents', icon: 'Bot', shortcut: '3' },
  { href: '/sessions', label: 'Sessions', icon: 'Play', shortcut: '4' },
  { href: '/discover', label: 'Discover', icon: 'Search', shortcut: '5' },
  { href: '/logs', label: 'Logs', icon: 'BarChart3', shortcut: '6' },
  { href: '/settings', label: 'Settings', icon: 'Settings', shortcut: '7' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const item = NAV_ITEMS.find((n) => n.shortcut === e.key);
      if (item) {
        e.preventDefault();
        router.push(item.href);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [router]);

  return (
    <nav className="flex h-full w-[220px] min-w-[220px] flex-col border-r border-border bg-card py-4">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 pb-5">
        <span className="text-lg font-bold tracking-tight">AgentCTL</span>
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary">
          BETA
        </span>
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 border-l-[3px] px-5 py-2.5 text-sm transition-colors',
              isActive
                ? 'border-primary bg-muted font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted',
            )}
          >
            {/* Icon component rendered here */}
            <span className="flex-1">{item.label}</span>
            <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-mono">
              {item.shortcut}
            </kbd>
          </Link>
        );
      })}

      <div className="flex-1" />

      {/* Footer */}
      <div className="border-t border-border px-5 pt-2.5 text-xs text-muted-foreground">
        AgentCTL v0.1.0
      </div>
    </nav>
  );
}
```

### 7.2 StatusBadge -> shadcn/ui Badge Variant

The current `StatusBadge` maps status strings to colors. This becomes a styled variant of the shadcn Badge:

```typescript
// src/components/data-display/status-badge.tsx
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_VARIANTS: Record<string, string> = {
  online: 'bg-green-500/10 text-green-500 border-green-500/20',
  running: 'bg-green-500/10 text-green-500 border-green-500/20',
  active: 'bg-green-500/10 text-green-500 border-green-500/20',
  ok: 'bg-green-500/10 text-green-500 border-green-500/20',
  registered: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  starting: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  stopping: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  degraded: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  offline: 'bg-muted text-muted-foreground border-transparent',
  stopped: 'bg-muted text-muted-foreground border-transparent',
  ended: 'bg-muted text-muted-foreground border-transparent',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
  timeout: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANTS[status] ?? 'bg-muted text-muted-foreground';

  return (
    <Badge variant="outline" className={cn('gap-1.5 capitalize', variant)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </Badge>
  );
}
```

### 7.3 StatCard -> shadcn/ui Card

```typescript
// src/components/data-display/stat-card.tsx
import { Card, CardContent } from '@/components/ui/card';

type StatCardProps = {
  label: string;
  value: string;
  color?: string;
  sublabel?: string;
};

export function StatCard({ label, value, sublabel }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-1.5 text-2xl font-bold">{value}</div>
        {sublabel && (
          <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
        )}
      </CardContent>
    </Card>
  );
}
```

### 7.4 Toast -> Sonner

Replace the entire custom `Toast.tsx` (168 lines) with Sonner:

```typescript
// In app/layout.tsx:
import { Toaster } from 'sonner';

// Inside the layout JSX:
<Toaster theme="dark" richColors position="bottom-right" />

// Usage in any component:
import { toast } from 'sonner';

toast.success('Agent created');
toast.error('Failed to start agent');
toast.info('Session resumed');
```

### 7.5 Session Detail -> Dedicated Route

The current `SessionsPage.tsx` has a massive inline detail panel. In the new architecture, the session detail becomes its own route:

- `/sessions` -- session list (table view)
- `/sessions/[id]` -- full session detail view with conversation thread

The session preview panel from `DiscoverPage` becomes a shadcn `Sheet` (slide-in drawer) component.

### 7.6 Tables -> TanStack Table

The machines table on the Logs page and the implicit card grids on other pages will be replaced with TanStack Table instances. Example for machines:

```typescript
// src/components/tables/machines-table.tsx
'use client';

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import type { Machine } from '@/lib/api';
import { StatusBadge } from '@/components/data-display/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const columns: ColumnDef<Machine>[] = [
  {
    accessorKey: 'hostname',
    header: 'Hostname',
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.hostname}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {row.original.id}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'tailscaleIp',
    header: 'Tailscale IP',
    cell: ({ row }) => (
      <code className="text-xs">{row.original.tailscaleIp}</code>
    ),
  },
  {
    id: 'os',
    header: 'OS / Arch',
    cell: ({ row }) => `${row.original.os} / ${row.original.arch}`,
  },
  {
    id: 'capabilities',
    header: 'Max Agents',
    cell: ({ row }) =>
      row.original.capabilities?.maxConcurrentAgents ?? '-',
  },
];

export function MachinesTable({ data }: { data: Machine[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

---

## 8. Styling Migration

### 8.1 Tailwind CSS v4 Setup

Tailwind v4 uses CSS-first configuration. No `tailwind.config.js` or `tailwind.config.ts` file is needed.

**PostCSS configuration:**

```javascript
// postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

**Global CSS with theme variables:**

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  /* Map existing CSS variables to Tailwind theme tokens */
  --color-background: #0a0a0a;
  --color-foreground: #e5e5e5;
  --color-card: #141414;
  --color-card-foreground: #e5e5e5;
  --color-muted: #1e1e1e;
  --color-muted-foreground: #9ca3af;
  --color-border: #2e2e2e;
  --color-primary: #3b82f6;
  --color-primary-foreground: #ffffff;
  --color-destructive: #ef4444;
  --color-accent: #252525;
  --color-accent-foreground: #e5e5e5;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --font-family-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Light theme overrides (via next-themes data attribute) */
[data-theme="light"] {
  --color-background: #ffffff;
  --color-foreground: #0a0a0a;
  --color-card: #f9fafb;
  --color-card-foreground: #0a0a0a;
  --color-muted: #f3f4f6;
  --color-muted-foreground: #6b7280;
  --color-border: #e5e7eb;
  --color-accent: #f3f4f6;
  --color-accent-foreground: #0a0a0a;
}
```

### 8.2 CSS Variable Mapping

Current CSS variables -> Tailwind equivalents:

| Current CSS Variable | Tailwind Class | shadcn/ui Token |
|---------------------|---------------|-----------------|
| `var(--bg-primary)` | `bg-background` | `background` |
| `var(--bg-secondary)` | `bg-card` | `card` |
| `var(--bg-tertiary)` | `bg-muted` | `muted` |
| `var(--bg-hover)` | `bg-accent` | `accent` |
| `var(--border)` | `border-border` | `border` |
| `var(--text-primary)` | `text-foreground` | `foreground` |
| `var(--text-secondary)` | `text-muted-foreground` | `muted-foreground` |
| `var(--text-muted)` | `text-muted-foreground/60` | -- |
| `var(--accent)` | `text-primary` | `primary` |
| `var(--green)` | `text-green-500` | -- |
| `var(--yellow)` | `text-yellow-500` | -- |
| `var(--red)` | `text-destructive` | `destructive` |
| `var(--font-mono)` | `font-mono` | -- |
| `var(--radius)` | `rounded-md` | `--radius-md` |
| `var(--radius-sm)` | `rounded-sm` | `--radius-sm` |

### 8.3 Inline Style Conversion Examples

**Before:**
```tsx
<div style={{
  padding: 24,
  maxWidth: 1100,
}}>
```

**After:**
```tsx
<div className="p-6 max-w-5xl">
```

**Before:**
```tsx
<h1 style={{ fontSize: 22, fontWeight: 700 }}>Command Center</h1>
```

**After:**
```tsx
<h1 className="text-xl font-bold">Command Center</h1>
```

**Before:**
```tsx
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
  marginBottom: 24,
}}>
```

**After:**
```tsx
<div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-6">
```

### 8.4 `cn()` Utility

The standard shadcn/ui utility for conditional class merging:

```typescript
// src/lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

---

## 9. Monorepo Integration

### 9.1 Package Configuration

Update `packages/web/package.json`:

```json
{
  "name": "@agentctl/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 5173",
    "build": "next build",
    "start": "next start --port 5173",
    "lint": "next lint",
    "test": "echo 'no tests yet'"
  },
  "dependencies": {
    "@agentctl/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.0",
    "@tanstack/react-query-devtools": "^5.62.0",
    "@tanstack/react-table": "^8.21.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "next": "^15.2.0",
    "next-themes": "^0.4.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "sonner": "^2.0.0",
    "tailwind-merge": "^3.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

### 9.2 TypeScript Configuration

Update `packages/web/tsconfig.json` for Next.js:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "preserve",
    "incremental": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 9.3 Next.js Config for Monorepo

The `transpilePackages` option in `next.config.ts` tells Next.js to compile the shared package:

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@agentctl/shared'],
  // ... rewrites as shown in section 6.3
};

export default nextConfig;
```

### 9.4 Shared Package Consumption

The `@agentctl/shared` package exports types and utilities. Since it builds to `dist/`, and Next.js transpiles it via `transpilePackages`, imports work as-is:

```typescript
import { ControlPlaneError } from '@agentctl/shared';
import type { AgentConfig } from '@agentctl/shared';
```

If the shared package needs to be consumed without building first during development, add its `src/` to the transpile list or configure the shared package to export from `src/` in dev mode. The simplest approach is to ensure `pnpm dev:shared` (which runs `tsc --watch`) is running alongside the web dev server.

### 9.5 Biome Compatibility

Next.js generates files that Biome may flag. Add to the root `biome.json`:

```json
{
  "files": {
    "ignore": [
      "packages/web/.next/**",
      "packages/web/next-env.d.ts"
    ]
  }
}
```

---

## 10. Migration Phases

### Phase 1: Scaffold Next.js App (1-2 days)

**Goal:** Next.js boots, routes work, existing functionality is accessible via new URLs.

1. Create `feat/nextjs-migration` branch
2. Delete Vite-specific files:
   - `vite.config.ts`
   - `index.html`
   - `src/vite-env.d.ts`
   - `src/main.tsx`
   - `src/App.tsx`
3. Create Next.js configuration:
   - `next.config.ts` (with rewrites for API proxy)
   - `postcss.config.mjs` (empty for now, Tailwind comes in Phase 3)
   - `tsconfig.json` (updated for Next.js)
   - Update `package.json` (add `next`, update scripts)
4. Create the app directory structure:
   - `src/app/layout.tsx` -- root layout with sidebar and existing `index.css`
   - `src/app/page.tsx` -- render `DashboardPage`
   - `src/app/machines/page.tsx` -- render `MachinesPage`
   - `src/app/agents/page.tsx` -- render `AgentsPage`
   - `src/app/sessions/page.tsx` -- render `SessionsPage`
   - `src/app/discover/page.tsx` -- render `DiscoverPage`
   - `src/app/logs/page.tsx` -- render `LogsPage`
5. Update Sidebar to use `<Link>` and `usePathname()` instead of `useState`
6. Keep all existing inline styles and `usePolling` hooks -- they still work in Client Components
7. Update `useWebSocket` to replace `import.meta.env.DEV` with `process.env.NODE_ENV`

**Verification:** All 6 pages render correctly, navigation works via sidebar links, browser back/forward works, URLs are deep-linkable.

### Phase 2: Add TanStack Query (1-2 days)

**Goal:** Replace `usePolling` with TanStack Query, add mutation hooks.

1. Install `@tanstack/react-query` and `@tanstack/react-query-devtools`
2. Create:
   - `src/providers/query-provider.tsx`
   - `src/lib/query-keys.ts`
   - `src/lib/query-functions.ts`
3. Add `QueryProvider` to `src/app/layout.tsx`
4. Migrate each page one at a time:
   - Replace `usePolling<T>({ fetcher, intervalMs })` with `useQuery(queryOptions)`
   - Replace manual `refresh()` calls with `queryClient.invalidateQueries()`
   - Replace inline create/start/stop handlers with `useMutation`
5. Delete `src/hooks/use-polling.ts` after all pages are migrated
6. Add `loading.tsx` skeleton files for each route

**Verification:** All data loads correctly, background refetching works, navigating between pages shows cached data instantly, DevTools show correct cache state.

### Phase 3: Add Tailwind + shadcn/ui (3-4 days)

**Goal:** Replace all inline styles with Tailwind classes and shadcn/ui components.

This is the largest phase because every component needs its styles rewritten. Do it in this order:

1. Install Tailwind CSS v4 and configure `postcss.config.mjs`
2. Replace `src/index.css` with `src/app/globals.css` using Tailwind directives and theme variables
3. Run `npx shadcn@latest init` to set up shadcn/ui
4. Install shadcn/ui components:
   ```bash
   npx shadcn@latest add button card badge table dialog sheet input select tabs toast skeleton separator dropdown-menu command
   ```
5. Create `src/lib/utils.ts` with `cn()` helper
6. Migrate layout components first:
   - `Sidebar` -- `<Link>` + Tailwind classes (already partially done in Phase 1)
   - `StatCard` -- shadcn `Card` component
   - `StatusBadge` -- shadcn `Badge` with variant classes
   - `CopyableText` -- Tailwind classes
7. Migrate page components one at a time (start with smallest):
   - `LogsPage` -- table becomes TanStack Table with shadcn Table
   - `MachinesPage` -- card grid with Tailwind
   - `AgentsPage` -- card grid + forms with shadcn Input/Select/Button
   - `DashboardPage` -- grid layout with Tailwind
   - `DiscoverPage` -- grouped list with Tailwind
   - `SessionsPage` -- table/list + detail panel
8. Replace custom `Toast.tsx` with Sonner:
   - Install `sonner`
   - Add `<Toaster>` to root layout
   - Replace all `useToast().success/error/info` with `toast.success/error/info` from Sonner
   - Delete `src/components/Toast.tsx`
9. Add `next-themes` for dark/light mode toggle
10. Delete `src/index.css` after all styles are migrated

**Verification:** Visual diff against current app should show nearly identical dark theme. All components render correctly with Tailwind classes. Accessibility audit passes (shadcn components are built on Radix primitives with proper ARIA attributes).

### Phase 4: Add Real-Time Features (1-2 days)

**Goal:** SSE streaming for session output, WebSocket improvements.

1. Create `src/hooks/use-sse-stream.ts`
2. Create session detail route:
   - `src/app/sessions/[id]/page.tsx` -- full session view with conversation thread
   - Uses TanStack Query for initial session data
   - Uses SSE hook for real-time output streaming
3. Extract `SessionPreview` into a Sheet (shadcn) component for use on the Discover page
4. Extract `MessageBubble` into its own component at `src/components/data-display/message-bubble.tsx`
5. Add `ws-status-indicator.tsx` as a small component used in the Dashboard header

**Verification:** Session detail page loads and displays conversation. SSE stream connects and displays new messages in real-time. WebSocket status indicator shows correct connection state.

### Phase 5: New Pages (1-2 days)

**Goal:** Add Settings and Router Config pages.

1. Create settings layout with tabs:
   - `src/app/settings/layout.tsx` -- shared layout with tab navigation
   - `src/app/settings/page.tsx` -- general settings
   - `src/app/settings/router/page.tsx` -- LiteLLM router configuration
2. Settings page content:
   - Control plane URL configuration
   - Tailscale mesh status
   - Memory sync configuration
   - Theme selection (already works via `next-themes`)
3. Router config page:
   - Fetch models from `GET /api/router/models` (existing endpoint)
   - Display model table with provider, status, cost
   - Add/remove model configuration forms

**Verification:** Settings pages render, navigation between settings tabs works, router config displays model information from the API.

### Phase 6: Cleanup and Polish (1 day)

1. Delete all files that are no longer needed:
   - `src/hooks/use-polling.ts` (replaced by TanStack Query)
   - `src/components/Toast.tsx` (replaced by Sonner)
   - `src/index.css` (replaced by `globals.css`)
   - `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`
2. Add `not-found.tsx` page
3. Add `error.tsx` error boundaries
4. Run Biome format/lint fix across all new files
5. Update root `package.json` scripts if needed
6. Update `CLAUDE.md` project structure section
7. Performance audit: check bundle sizes, verify code splitting works

---

## 11. Risk Assessment

### 11.1 Low Risk

| Risk | Mitigation |
|------|-----------|
| TanStack Query API differs from usePolling | API surface is similar; migration is mechanical |
| Tailwind class names unfamiliar | IDE extensions (Tailwind CSS IntelliSense) provide autocomplete |
| shadcn/ui component API changes | Components are source code in our repo, not a dependency |

### 11.2 Medium Risk

| Risk | Mitigation |
|------|-----------|
| WebSocket in App Router | Self-hosted (not Vercel), connects to external backend, no limitation |
| `import.meta.env.DEV` usage in hooks | Replace with `process.env.NODE_ENV === 'development'` |
| Large Phase 3 (styling) | Migrate page-by-page, verify each before moving on |
| Tailwind v4 CSS-first config | New pattern, but simpler than v3 JS config |

### 11.3 High Risk

| Risk | Mitigation |
|------|-----------|
| Phase 1 breaks existing functionality | Keep old code on `main` branch; migration is on a feature branch |
| Inline styles -> Tailwind visual regression | Screenshot comparison before/after each page migration |
| pnpm + Next.js monorepo build issues | `transpilePackages` is the official solution; well-documented |

### 11.4 Out of Scope

The following are explicitly not part of this migration:

- Server-side rendering of page data (all pages remain Client Components with client-side fetching)
- API route handlers in Next.js (the control-plane backend handles all APIs)
- Authentication/authorization (handled at the network level via Tailscale)
- Mobile responsiveness (separate mobile app exists at `packages/mobile`)
- Internationalization
- End-to-end tests (can be added later with Playwright)

---

## 12. References

- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [Next.js Project Structure Guide](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js Production Checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [shadcn/ui Installation for Next.js](https://ui.shadcn.com/docs/installation/next)
- [shadcn/ui Changelog](https://ui.shadcn.com/docs/changelog)
- [shadcn/ui Visual Project Builder](https://www.infoq.com/news/2026/02/shadcn-ui-builder/)
- [TanStack Query v5 Advanced Server Rendering](https://tanstack.com/query/v5/docs/react/guides/advanced-ssr)
- [TanStack Query + Next.js App Router Guide](https://ihsaninh.com/blog/the-complete-guide-to-tanstack-query-next.js-app-router)
- [Tailwind CSS v4 Migration Guide](https://designrevision.com/blog/tailwind-4-migration)
- [Tailwind + Next.js Setup Guide (2026)](https://designrevision.com/blog/tailwind-nextjs-setup)
- [Tailwind CSS v4 Release Notes](https://tailwindcss.com/blog/tailwindcss-v4)
- [WebSocket and SSE in Next.js App Router](https://eastondev.com/blog/en/posts/dev/20260107-nextjs-realtime-chat/)
- [SSE in Next.js for Real-Time Notifications](https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/)
- [Streaming in Next.js 15: WebSockets vs SSE](https://hackernoon.com/streaming-in-nextjs-15-websockets-vs-server-sent-events)
- [Next.js pnpm Monorepo Guide (2026)](https://medium.com/@oxm/how-i-built-a-professional-full-stack-monorepo-with-next-js-node-js-and-pnpm-workspaces-2026-1b8f5ac66bf9)
- [pnpm Workspaces Documentation](https://pnpm.io/next/workspaces)
- [Next.js + Turborepo Monorepo Guide](https://turborepo.dev/docs/guides/frameworks/nextjs)
