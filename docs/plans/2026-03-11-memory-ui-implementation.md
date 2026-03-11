# Unified Memory System UI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete memory management UI and backend API for AgentCTL's unified memory system — 8 pages, REST API, MCP tools, and integration into existing pages.

**Architecture:** Full-stack vertical — each page ships end-to-end (API route → shared types → UI component → test) in priority order. Left sidebar navigation within a top-level `/memory` route. Backend uses existing `MemoryStore` and `MemorySearch` from `packages/control-plane/src/memory/`. Frontend follows existing patterns: Next.js App Router pages delegate to `'use client'` Views using TanStack React Query.

**Tech Stack:** TypeScript, Fastify (CP routes), Next.js 14 App Router, TanStack React Query + Table + Virtual, react-force-graph-2d, recharts, nuqs, shadcn/ui, Vitest, React Testing Library.

**Design Spec:** `docs/plans/2026-03-11-memory-ui-design.md`

---

## Chunk 1: Foundation — Types, API Core, Shared Components, Layout

### Task 1.1: Add New Shared Types

**Files:**
- Modify: `packages/shared/src/types/memory.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/types/memory.test.ts` (or create if missing)

- [ ] **Step 1: Write test for new types**

Add to `packages/shared/src/types/memory.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import type {
  ConsolidationItem,
  ImportJob,
  MemoryReport,
  MemoryStats,
} from './memory.js';

describe('memory types — consolidation', () => {
  it('represents a consolidation review item', () => {
    const item: ConsolidationItem = {
      id: 'ci-1',
      type: 'contradiction',
      severity: 'high',
      factIds: ['fact-1', 'fact-2'],
      suggestion: 'Keep fact-1, supersede fact-2',
      reason: 'fact-1 is newer and higher confidence',
      status: 'pending',
      createdAt: '2026-03-11T10:00:00Z',
    };
    expect(item.type).toBe('contradiction');
    expect(item.severity).toBe('high');
  });
});

describe('memory types — reports', () => {
  it('represents a generated memory report', () => {
    const report: MemoryReport = {
      id: 'rpt-1',
      type: 'project-progress',
      scope: 'project:agentctl',
      periodStart: '2026-03-04T00:00:00Z',
      periodEnd: '2026-03-11T00:00:00Z',
      content: '## Weekly Progress\n...',
      metadata: { factCount: 120, newFacts: 15, topEntities: ['pgvector', 'Biome'] },
      generatedAt: '2026-03-11T12:00:00Z',
    };
    expect(report.type).toBe('project-progress');
  });
});

describe('memory types — import job', () => {
  it('represents a claude-mem import job', () => {
    const job: ImportJob = {
      id: 'imp-1',
      source: 'claude-mem',
      status: 'running',
      progress: { current: 42, total: 847 },
      imported: 40,
      skipped: 2,
      errors: 0,
      startedAt: '2026-03-11T10:00:00Z',
      completedAt: null,
    };
    expect(job.status).toBe('running');
  });
});

describe('memory types — stats', () => {
  it('represents dashboard memory statistics', () => {
    const stats: MemoryStats = {
      totalFacts: 1247,
      newThisWeek: 87,
      avgConfidence: 0.82,
      pendingConsolidation: 7,
      byScope: { global: 124, 'project:agentctl': 892 },
      byEntityType: { pattern: 420, decision: 280 },
      strengthDistribution: { active: 1110, decaying: 100, archived: 37 },
      growthTrend: [{ date: '2026-03-10', count: 12 }, { date: '2026-03-11', count: 15 }],
    };
    expect(stats.totalFacts).toBe(1247);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentctl/shared test -- --run`
Expected: FAIL — types not defined yet.

- [ ] **Step 3: Add types to memory.ts**

Append to `packages/shared/src/types/memory.ts`:
```typescript
export type ConsolidationItemType = 'contradiction' | 'near-duplicate' | 'stale' | 'orphan';
export type ConsolidationSeverity = 'high' | 'medium' | 'low';
export type ConsolidationStatus = 'pending' | 'accepted' | 'skipped';

export type ConsolidationItem = {
  id: string;
  type: ConsolidationItemType;
  severity: ConsolidationSeverity;
  factIds: string[];
  suggestion: string;
  reason: string;
  status: ConsolidationStatus;
  createdAt: string;
};

export type MemoryReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';

export type MemoryReport = {
  id: string;
  type: MemoryReportType;
  scope: string;
  periodStart: string;
  periodEnd: string;
  content: string;
  metadata: {
    factCount: number;
    newFacts: number;
    topEntities: string[];
  };
  generatedAt: string;
};

export type ImportJobSource = 'claude-mem' | 'jsonl-history';
export type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ImportJob = {
  id: string;
  source: ImportJobSource;
  status: ImportJobStatus;
  progress: { current: number; total: number };
  imported: number;
  skipped: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
};

export type MemoryStats = {
  totalFacts: number;
  newThisWeek: number;
  avgConfidence: number;
  pendingConsolidation: number;
  byScope: Record<string, number>;
  byEntityType: Record<string, number>;
  strengthDistribution: { active: number; decaying: number; archived: number };
  growthTrend: ReadonlyArray<{ date: string; count: number }>;
};
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/shared/src/types/index.ts` exports:
```typescript
export type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  ConsolidationStatus,
  ImportJob,
  ImportJobSource,
  ImportJobStatus,
  MemoryReport,
  MemoryReportType,
  MemoryStats,
} from './memory.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agentctl/shared test -- --run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/memory.ts packages/shared/src/types/index.ts packages/shared/src/types/memory.test.ts
git commit -m "feat(shared): add ConsolidationItem, MemoryReport, ImportJob, MemoryStats types"
```

---

### Task 1.2: Memory Facts API Route (CRUD + Search)

This is the core API that all frontend pages consume. Wraps the existing `MemoryStore` and `MemorySearch`.

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-facts.ts`
- Create: `packages/control-plane/src/api/routes/memory-facts.test.ts`
- Modify: `packages/control-plane/src/api/server.ts` (register new route)

- [ ] **Step 1: Write route tests**

Create `packages/control-plane/src/api/routes/memory-facts.test.ts`. Use the established pattern from `run-summary.test.ts` — factory helpers, `createMockLogger`, Fastify `app.inject`.

Test cases:
1. `GET /api/memory/facts` — returns facts list with search/filter params
2. `POST /api/memory/facts` — creates a fact, returns 201
3. `GET /api/memory/facts/:id` — returns single fact with edges
4. `PATCH /api/memory/facts/:id` — updates fact fields
5. `DELETE /api/memory/facts/:id` — soft-deletes (invalidates)
6. `GET /api/memory/facts?sessionId=X` — filters by session
7. `GET /api/memory/facts?agentId=X` — filters by agent

Mock the `MemoryStore` and `MemorySearch` interfaces. Use factory function `makeFact()` returning a `MemoryFact` with sensible defaults + overrides.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agentctl/control-plane test -- --run -t "memoryFactRoutes"`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `packages/control-plane/src/api/routes/memory-facts.ts`:

```typescript
import type { EntityType, MemoryFact, MemorySearchResult } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore } from '../../memory/memory-store.js';

type RouteOptions = {
  memoryStore: MemoryStore;
  memorySearch: MemorySearch;
};

export const memoryFactRoutes: FastifyPluginAsync<RouteOptions> = async (app, opts) => {
  const { memoryStore, memorySearch } = opts;

  // GET /facts — list/search
  app.get<{
    Querystring: {
      q?: string;
      scope?: string;
      entityType?: EntityType;
      sessionId?: string;
      agentId?: string;
      machineId?: string;
      minConfidence?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', { schema: { tags: ['memory'], summary: 'Search or list memory facts' } }, async (request) => {
    const { q, scope, entityType, sessionId, agentId, machineId, minConfidence, limit, offset } = request.query;
    // If search query provided, use hybrid search
    // Otherwise, list with filters
    // Return { ok: true, facts: [...], total: N }
  });

  // POST /facts — create
  app.post<{
    Body: { content: string; scope: string; entityType: EntityType; confidence?: number; source?: Record<string, unknown> };
  }>('/','{ schema: { tags: ['memory'], summary: 'Create a memory fact' } }, async (request, reply) => {
    // Validate body, call memoryStore.addFact(), return 201
  });

  // GET /facts/:id — get single with edges
  app.get<{ Params: { id: string } }>('/:id', { schema: { tags: ['memory'] } }, async (request, reply) => {
    // memoryStore.getFact(id), include edges
  });

  // PATCH /facts/:id — update
  app.patch<{ Params: { id: string }; Body: Partial<MemoryFact> }>('/:id', { schema: { tags: ['memory'] } }, async (request, reply) => {
    // Update fields: content, scope, entityType, confidence, pinned
  });

  // DELETE /facts/:id — soft delete
  app.delete<{ Params: { id: string } }>('/:id', { schema: { tags: ['memory'] } }, async (request, reply) => {
    // memoryStore.invalidateFact(id)
  });
};
```

Follow the exact patterns from `packages/control-plane/src/api/routes/memory.ts` for error handling (ControlPlaneError checks, error envelopes).

- [ ] **Step 4: Register route in server.ts**

Add to `packages/control-plane/src/api/server.ts`:
- Import `memoryFactRoutes`
- Construct `MemoryStore` and `MemorySearch` instances when `db` is available
- Register: `app.register(memoryFactRoutes, { prefix: '/api/memory/facts', memoryStore, memorySearch })`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agentctl/control-plane test -- --run -t "memoryFactRoutes"`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/api/routes/memory-facts.ts packages/control-plane/src/api/routes/memory-facts.test.ts packages/control-plane/src/api/server.ts
git commit -m "feat(cp): add /api/memory/facts CRUD + search routes"
```

---

### Task 1.3: Memory Edges & Graph API Routes

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-edges.ts`
- Create: `packages/control-plane/src/api/routes/memory-edges.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`

Same pattern as Task 1.2. Endpoints:
- `GET /api/memory/edges` — list edges (filter by sourceFactId, targetFactId)
- `POST /api/memory/edges` — create edge
- `DELETE /api/memory/edges/:id` — remove edge
- `GET /api/memory/graph` — return `{ nodes: MemoryFact[], edges: MemoryEdge[] }` for visualization

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement routes**
- [ ] **Step 4: Register in server.ts**
- [ ] **Step 5: Run tests to verify pass**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(cp): add /api/memory/edges and /api/memory/graph routes"
```

---

### Task 1.4: Memory Stats API Route

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-stats.ts`
- Create: `packages/control-plane/src/api/routes/memory-stats.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`

Single endpoint: `GET /api/memory/stats` returning `MemoryStats`.

Queries the `memory_facts` table for:
- `COUNT(*)` total, `COUNT(*) WHERE created_at > now() - interval '7 days'` for newThisWeek
- `AVG(confidence)` for avgConfidence
- `GROUP BY scope` for byScope, `GROUP BY entity_type` for byEntityType
- Strength bands: active (>0.5), decaying (0.05-0.5), archived (<0.05)
- Growth trend: `COUNT(*) GROUP BY DATE(created_at)` for last 30 days

- [ ] **Step 1-6: TDD cycle (test → fail → implement → pass → commit)**

```bash
git commit -m "feat(cp): add /api/memory/stats dashboard metrics route"
```

---

### Task 1.5: Install Frontend Dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install new dependencies**

```bash
cd packages/web
pnpm add react-force-graph-2d recharts nuqs
pnpm add -D @types/react-force-graph-2d
```

Note: `@tanstack/react-table`, `@tanstack/react-virtual` are likely already installed. Check first.

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @agentctl/web build
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(web): add react-force-graph-2d, recharts, nuqs dependencies"
```

---

### Task 1.6: Memory API Client Functions

**Files:**
- Modify: `packages/web/src/lib/api.ts`

Add API client functions following existing patterns (thin fetch wrappers):

- [ ] **Step 1: Add memory API functions**

```typescript
// Memory API
export async function searchMemoryFacts(params: {
  q?: string;
  scope?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ ok: boolean; facts: MemoryFact[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set('q', params.q);
  if (params.scope) searchParams.set('scope', params.scope);
  // ... other params
  const res = await fetch(`/api/memory/facts?${searchParams.toString()}`);
  return res.json();
}

export async function getMemoryFact(id: string): Promise<{ ok: boolean; fact: MemoryFact; edges: MemoryEdge[] }> { ... }
export async function createMemoryFact(input: { content: string; scope: string; entityType: string; confidence?: number }): Promise<{ ok: boolean; fact: MemoryFact }> { ... }
export async function updateMemoryFact(id: string, patch: Partial<MemoryFact>): Promise<{ ok: boolean; fact: MemoryFact }> { ... }
export async function deleteMemoryFact(id: string): Promise<{ ok: boolean }> { ... }
export async function getMemoryGraph(params?: { scope?: string; entityType?: string }): Promise<{ ok: boolean; nodes: MemoryFact[]; edges: MemoryEdge[] }> { ... }
export async function getMemoryStats(): Promise<{ ok: boolean; stats: MemoryStats }> { ... }
```

- [ ] **Step 2: Add React Query hooks**

Create `packages/web/src/lib/memory-queries.ts`:

```typescript
import { queryOptions } from '@tanstack/react-query';
import { getMemoryFact, getMemoryGraph, getMemoryStats, searchMemoryFacts } from './api.js';

export function memoryFactsQuery(params: { q?: string; scope?: string; entityType?: string; limit?: number }) {
  return queryOptions({
    queryKey: ['memory-facts', params],
    queryFn: () => searchMemoryFacts(params),
  });
}

export function memoryFactQuery(id: string) {
  return queryOptions({
    queryKey: ['memory-fact', id],
    queryFn: () => getMemoryFact(id),
    enabled: !!id,
  });
}

export function memoryGraphQuery(params?: { scope?: string; entityType?: string }) {
  return queryOptions({
    queryKey: ['memory-graph', params],
    queryFn: () => getMemoryGraph(params),
  });
}

export function memoryStatsQuery() {
  return queryOptions({
    queryKey: ['memory-stats'],
    queryFn: () => getMemoryStats(),
    refetchInterval: 60_000, // refresh every minute
  });
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): add memory API client functions and React Query hooks"
```

---

### Task 1.7: Shared UI Components

**Files:**
- Create: `packages/web/src/components/memory/EntityTypeBadge.tsx`
- Create: `packages/web/src/components/memory/EntityTypeBadge.test.tsx`
- Create: `packages/web/src/components/memory/ScopeBadge.tsx`
- Create: `packages/web/src/components/memory/ScopeBadge.test.tsx`
- Create: `packages/web/src/components/memory/ConfidenceBar.tsx`
- Create: `packages/web/src/components/memory/ConfidenceBar.test.tsx`
- Create: `packages/web/src/components/memory/FactCard.tsx`
- Create: `packages/web/src/components/memory/FactCard.test.tsx`
- Create: `packages/web/src/components/memory/FactDetailPanel.tsx`
- Create: `packages/web/src/components/memory/FactDetailPanel.test.tsx`
- Create: `packages/web/src/components/memory/MemorySidebar.tsx`
- Create: `packages/web/src/components/memory/MemorySidebar.test.tsx`
- Create: `packages/web/src/components/memory/ScopeSelector.tsx`
- Create: `packages/web/src/components/memory/ScopeSelector.test.tsx`

Build each component using TDD. Key implementation notes:

**EntityTypeBadge:** Maps entity type → color class. Use Tailwind classes.
```typescript
const ENTITY_COLORS: Record<EntityType, string> = {
  pattern: 'bg-green-500/20 text-green-400',
  decision: 'bg-amber-500/20 text-amber-400',
  error: 'bg-red-500/20 text-red-400',
  concept: 'bg-blue-500/20 text-blue-400',
  code_artifact: 'bg-purple-500/20 text-purple-400',
  preference: 'bg-gray-500/20 text-gray-400',
  person: 'bg-teal-500/20 text-teal-400',
};
```

**ScopeBadge:** Parse scope string → color. `global` = blue, `project:*` = green, `agent:*` = orange, `session:*` = gray.

**ConfidenceBar:** Horizontal bar with color thresholds. Width = `confidence * 100%`.

**FactCard:** Composes EntityTypeBadge + ScopeBadge + ConfidenceBar. Shows content (truncated), source info, timestamps. Clickable → triggers `onSelect` callback.

**FactDetailPanel:** Slide-over sheet (use shadcn Sheet component if available, otherwise fixed right panel). Shows full fact content, editable fields, relationship list, source links, action buttons.

**MemorySidebar:** Navigation links matching the route structure. Active state from `usePathname()`. Badge counts from `memoryStatsQuery()`.

**ScopeSelector:** Dropdown or combobox with scope hierarchy. Use shadcn Command/Popover pattern.

- [ ] **Step 1-6 per component: TDD cycle**

Follow web test patterns: `vi.mock` external deps, `render/screen` from RTL, factory helpers.

- [ ] **Step 7: Commit all components**

```bash
git commit -m "feat(web): add shared memory UI components (FactCard, badges, sidebar, detail panel)"
```

---

### Task 1.8: Memory Layout & Route Structure

**Files:**
- Create: `packages/web/src/app/memory/layout.tsx`
- Create: `packages/web/src/app/memory/page.tsx` (redirect to /memory/browser)
- Create: `packages/web/src/app/memory/browser/page.tsx`
- Create: `packages/web/src/app/memory/graph/page.tsx`
- Create: `packages/web/src/app/memory/dashboard/page.tsx`
- Create: `packages/web/src/app/memory/consolidation/page.tsx`
- Create: `packages/web/src/app/memory/reports/page.tsx`
- Create: `packages/web/src/app/memory/import/page.tsx`
- Create: `packages/web/src/app/memory/scopes/page.tsx`

- [ ] **Step 1: Create layout with sidebar**

`packages/web/src/app/memory/layout.tsx`:
```typescript
import type { Metadata } from 'next';
import { MemorySidebar } from '@/components/memory/MemorySidebar';

export const metadata: Metadata = { title: 'Memory' };

export default function MemoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <MemorySidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create redirect page**

`packages/web/src/app/memory/page.tsx`:
```typescript
import { redirect } from 'next/navigation';

export default function MemoryPage() {
  redirect('/memory/browser');
}
```

- [ ] **Step 3: Create stub pages for each sub-route**

Each page follows the thin-wrapper pattern:
```typescript
import type { Metadata } from 'next';
import { MemoryBrowserView } from '@/views/MemoryBrowserView';

export const metadata: Metadata = { title: 'Memory Browser' };

export default function Page() {
  return <MemoryBrowserView />;
}
```

Create placeholder Views that render "Coming soon" for each page.

- [ ] **Step 4: Add Memory to main navigation**

Modify `packages/web/src/components/Sidebar.tsx` (the main app sidebar) — add a "Memory" nav item linking to `/memory`.

- [ ] **Step 5: Verify build**

```bash
pnpm --filter @agentctl/web build
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): add /memory route structure with layout, sidebar, and stub pages"
```

---

## Chunk 2: Memory Browser Page

### Task 2.1: Memory Browser View

**Files:**
- Create: `packages/web/src/views/MemoryBrowserView.tsx`
- Create: `packages/web/src/views/MemoryBrowserView.test.tsx`
- Create: `packages/web/src/components/memory/MemoryFilterSidebar.tsx`
- Create: `packages/web/src/components/memory/MemoryFilterSidebar.test.tsx`
- Create: `packages/web/src/components/memory/MemorySearchBar.tsx`
- Create: `packages/web/src/components/memory/MemorySearchBar.test.tsx`

**Layout:** Three-column — MemoryFilterSidebar (left, 240px), results list (center, flex-1), FactDetailPanel (right, 360px, conditional).

- [ ] **Step 1: Write MemorySearchBar tests**

Test: renders input, fires onSearch callback on debounced input, shows mode toggle (Semantic/Keyword/Hybrid).

- [ ] **Step 2: Implement MemorySearchBar**

Debounced input (300ms) using `useDeferredValue` or custom hook. Mode toggle as segmented control. Calls `onSearch(query, mode)`.

- [ ] **Step 3: Write MemoryFilterSidebar tests**

Test: renders scope checkboxes, entity type checkboxes, confidence slider, date range picker. Fires `onFilterChange` callback.

- [ ] **Step 4: Implement MemoryFilterSidebar**

Uses `nuqs` for URL state persistence. Each filter group is a collapsible section. Scope shown as checkbox tree. Entity types with count badges.

- [ ] **Step 5: Write MemoryBrowserView tests**

Test: renders search bar + filter sidebar + results list. Mock `searchMemoryFacts` to return sample data. Test: clicking a fact opens FactDetailPanel. Test: empty state message. Test: loading skeleton.

- [ ] **Step 6: Implement MemoryBrowserView**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { parseAsString, useQueryState } from 'nuqs';

export function MemoryBrowserView(): React.JSX.Element {
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [scope, setScope] = useQueryState('scope', parseAsString.withDefault(''));
  const [entityType, setEntityType] = useQueryState('type', parseAsString.withDefault(''));
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);

  const facts = useQuery(memoryFactsQuery({ q: search, scope, entityType }));
  const selectedFact = useQuery(memoryFactQuery(selectedFactId ?? ''));

  return (
    <div className="flex h-full">
      <MemoryFilterSidebar onFilterChange={...} />
      <div className="flex-1 overflow-auto p-4">
        <MemorySearchBar value={search} onChange={setSearch} />
        {/* Results list with FactCards */}
        {facts.data?.facts.map(fact => (
          <FactCard key={fact.id} fact={fact} onClick={() => setSelectedFactId(fact.id)} />
        ))}
      </div>
      {selectedFactId && <FactDetailPanel fact={selectedFact.data?.fact} edges={selectedFact.data?.edges} />}
    </div>
  );
}
```

- [ ] **Step 7: Run all tests**

```bash
pnpm --filter @agentctl/web test -- --run
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(web): implement Memory Browser page with search, filters, and detail panel"
```

---

## Chunk 3: Knowledge Graph Page

### Task 3.1: Graph Visualization View

**Files:**
- Create: `packages/web/src/views/MemoryGraphView.tsx`
- Create: `packages/web/src/views/MemoryGraphView.test.tsx`
- Create: `packages/web/src/components/memory/GraphCanvas.tsx`
- Create: `packages/web/src/components/memory/GraphCanvas.test.tsx`
- Create: `packages/web/src/components/memory/GraphTableView.tsx`
- Create: `packages/web/src/components/memory/GraphTimelineView.tsx`
- Create: `packages/web/src/components/memory/GraphClustersView.tsx`

- [ ] **Step 1: Write GraphCanvas tests**

Test: renders without crashing (dynamic import mock), passes nodes/edges props.

- [ ] **Step 2: Implement GraphCanvas**

Wrap `react-force-graph-2d` with dynamic import:
```typescript
import dynamic from 'next/dynamic';
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });
```

Props: `nodes: MemoryFact[]`, `edges: MemoryEdge[]`, `onNodeClick`, `onNodeHover`, `focusNodeId?`.

Node rendering: color by entity type (reuse ENTITY_COLORS), size by edge count (min 4, max 20). Edge rendering: thin lines with optional relation label on hover.

- [ ] **Step 3: Implement GraphTableView**

TanStack Table with columns: content (truncated), entity_type (badge), scope (badge), confidence (bar), edge_count, created_at. Sortable columns. Click row → onSelect.

- [ ] **Step 4: Implement GraphTimelineView**

Vertical timeline. Facts ordered by created_at descending. Each entry: EntityTypeBadge, content preview (50 chars), ScopeBadge, relative timestamp. Group by date.

- [ ] **Step 5: Implement GraphClustersView**

Placeholder for MVP — show facts grouped by entity_type as simple collapsible sections. True community detection can be added later when the consolidation backend lands.

- [ ] **Step 6: Write MemoryGraphView tests**

Test: renders view mode tabs, defaults to Graph tab, switches views on click. Mock `getMemoryGraph` to return sample data.

- [ ] **Step 7: Implement MemoryGraphView**

```typescript
'use client';

export function MemoryGraphView(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<'graph' | 'table' | 'timeline' | 'clusters'>('graph');
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const graph = useQuery(memoryGraphQuery());

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        {/* View mode tabs */}
        <div className="border-b p-2 flex gap-2">
          {(['graph', 'table', 'timeline', 'clusters'] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)} className={viewMode === mode ? 'active' : ''}>
              {mode}
            </button>
          ))}
        </div>
        {/* View content */}
        {viewMode === 'graph' && <GraphCanvas nodes={graph.data?.nodes ?? []} edges={graph.data?.edges ?? []} onNodeClick={setSelectedFactId} />}
        {viewMode === 'table' && <GraphTableView facts={graph.data?.nodes ?? []} onSelect={setSelectedFactId} />}
        {viewMode === 'timeline' && <GraphTimelineView facts={graph.data?.nodes ?? []} onSelect={setSelectedFactId} />}
        {viewMode === 'clusters' && <GraphClustersView facts={graph.data?.nodes ?? []} onSelect={setSelectedFactId} />}
      </div>
      {selectedFactId && <FactDetailPanel factId={selectedFactId} />}
    </div>
  );
}
```

- [ ] **Step 8: Run tests, commit**

```bash
git commit -m "feat(web): implement Knowledge Graph page with multi-view and detail panel"
```

---

## Chunk 4: Dashboard, Consolidation, Reports

### Task 4.1: Memory Dashboard View

**Files:**
- Create: `packages/web/src/views/MemoryDashboardView.tsx`
- Create: `packages/web/src/views/MemoryDashboardView.test.tsx`
- Create: `packages/web/src/components/memory/KpiCard.tsx`
- Create: `packages/web/src/components/memory/GrowthChart.tsx`
- Create: `packages/web/src/components/memory/TypeDistributionChart.tsx`
- Create: `packages/web/src/components/memory/ActivityHeatmap.tsx`

Implementation: Uses `recharts` for Line/PieChart. KpiCard is a simple stat card (value, label, trend arrow). ActivityHeatmap is a custom SVG grid (52 weeks x 7 days). All data from `memoryStatsQuery()`.

- [ ] **Steps 1-6: TDD cycle for each component, then compose into MemoryDashboardView**

```bash
git commit -m "feat(web): implement Memory Dashboard with KPIs, charts, and activity heatmap"
```

---

### Task 4.2: Consolidation API + Backend Scanner

**Files:**
- Create: `packages/control-plane/src/memory/consolidation-scanner.ts`
- Create: `packages/control-plane/src/memory/consolidation-scanner.test.ts`
- Create: `packages/control-plane/src/api/routes/memory-consolidation.ts`
- Create: `packages/control-plane/src/api/routes/memory-consolidation.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`

**Scanner logic:**
1. **Contradictions:** Find pairs of facts in same scope where embedding cosine similarity > 0.85 but content sentiment/assertion differs. Use a simple heuristic: same entity_type, similar embeddings, but different key phrases.
2. **Near-duplicates:** Cosine similarity > 0.92 between any two facts in same scope.
3. **Stale facts:** `strength < 0.2 AND accessed_at < now() - interval '30 days'`.
4. **Orphans:** Facts with zero edges.

Store results in a `consolidation_items` table (new migration).

**API endpoints:**
- `GET /api/memory/consolidation` — returns `ConsolidationItem[]` sorted by severity
- `POST /api/memory/consolidation/:id/action` — body: `{ action: 'accept' | 'skip' | 'merge' | 'delete' }`

- [ ] **Steps 1-6: TDD cycle**

```bash
git commit -m "feat(cp): add consolidation scanner and review queue API"
```

---

### Task 4.3: Consolidation Board View

**Files:**
- Create: `packages/web/src/views/MemoryConsolidationView.tsx`
- Create: `packages/web/src/views/MemoryConsolidationView.test.tsx`
- Create: `packages/web/src/components/memory/ConsolidationItem.tsx`
- Create: `packages/web/src/components/memory/ConsolidationItem.test.tsx`

ConsolidationItem renders differently by type:
- Contradiction: side-by-side FactCards
- Near-duplicate: diff-highlighted comparison
- Stale: single FactCard with strength warning
- Orphan: single FactCard with "no relationships" indicator

Each item has action buttons. Accepting removes from queue (optimistic update via React Query mutation).

- [ ] **Steps 1-6: TDD cycle**

```bash
git commit -m "feat(web): implement Consolidation Board with priority queue"
```

---

### Task 4.4: Reports API + View

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-reports.ts`
- Create: `packages/control-plane/src/api/routes/memory-reports.test.ts`
- Create: `packages/web/src/views/MemoryReportsView.tsx`
- Create: `packages/web/src/views/MemoryReportsView.test.tsx`

**API:**
- `POST /api/memory/reports` — generates report (type, scope, periodStart, periodEnd). For project-progress, call LLM to generate summary. For knowledge-health, aggregate stats. For activity-digest, query recent operations.
- `GET /api/memory/reports/:id` — get generated report

**View:** Report generator form (type, scope, period selectors) + list of previously generated reports. Click to view rendered Markdown.

- [ ] **Steps 1-6: TDD cycle**

```bash
git commit -m "feat: add memory reports generation API and UI"
```

---

## Chunk 5: Import, Editor, Scopes, Integration, MCP

### Task 5.1: Import Wizard

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-import.ts`
- Create: `packages/control-plane/src/api/routes/memory-import.test.ts`
- Create: `scripts/import-claude-mem-to-pg.ts` (rewrite of existing `import-claude-mem.ts`)
- Create: `packages/web/src/views/MemoryImportView.tsx`
- Create: `packages/web/src/views/MemoryImportView.test.tsx`

**API:**
- `POST /api/memory/import` — body: `{ source: 'claude-mem', dbPath: string, mappings?: Record<string, string> }`. Starts background import job.
- `GET /api/memory/import/status` — returns `ImportJob` with progress

**Import script:** Rewrite `scripts/import-claude-mem.ts` to target `MemoryStore` (PostgreSQL) instead of Mem0. Follow the field mapping from `docs/plans/2026-03-11-claude-mem-migration-plan.md`:
- `observation.type` → `entity_type` (bugfix→error, feature→code_artifact, etc.)
- `observation.facts[]` → individual child facts with `summarizes` edges
- `observation.project` → `scope` (project:X or global)
- Dedup via embedding cosine > 0.92

**View:** 4-step wizard (stepper component). Step 1: source selection + auto-detect. Step 2: preview 10 rows with mapping overrides. Step 3: progress bar + live log (SSE or polling). Step 4: summary with rollback button.

- [ ] **Steps 1-8: TDD cycle per layer (script, API, View)**

```bash
git commit -m "feat: add claude-mem import wizard with progress tracking"
```

---

### Task 5.2: Fact Editor Modal

**Files:**
- Create: `packages/web/src/components/memory/FactEditorModal.tsx`
- Create: `packages/web/src/components/memory/FactEditorModal.test.tsx`

Sheet/dialog component. Props: `factId?: string` (edit mode) or `undefined` (create mode). Fields: content (textarea), entityType (select), scope (ScopeSelector), confidence (slider), pinned (toggle), relationships (list with add/remove).

Uses React Query mutations for create/update. On save, invalidates `memory-facts` and `memory-graph` query keys.

Wire into FactDetailPanel "Edit" button and MemoryBrowserView "New Fact" button.

- [ ] **Steps 1-6: TDD cycle**

```bash
git commit -m "feat(web): add FactEditorModal for creating and editing memory facts"
```

---

### Task 5.3: Scope Manager View

**Files:**
- Create: `packages/control-plane/src/api/routes/memory-scopes.ts`
- Create: `packages/control-plane/src/api/routes/memory-scopes.test.ts`
- Create: `packages/web/src/views/MemoryScopesView.tsx`
- Create: `packages/web/src/views/MemoryScopesView.test.tsx`

**API:**
- `GET /api/memory/scopes` — returns scope tree with fact counts
- `POST /api/memory/scopes` — create new scope
- `DELETE /api/memory/scopes/:id` — delete scope (must be empty)

**View:** Expandable tree. Each node: scope name, fact count badge. Click → actions (view facts, promote, merge, rename, delete). "New Scope" button.

- [ ] **Steps 1-6: TDD cycle**

```bash
git commit -m "feat: add scope manager with hierarchy tree and CRUD operations"
```

---

### Task 5.4: Integration into Existing Pages

**Files:**
- Modify: `packages/web/src/views/SessionDetailView.tsx` — add Memory tab
- Modify: `packages/web/src/views/AgentsPage.tsx` or agent detail — add memory section
- Modify: `packages/web/src/components/context-picker/MemoryPanel.tsx` — use unified API
- Modify: `packages/web/src/components/CommandPalette.tsx` — add memory commands
- Modify: `packages/web/src/components/Sidebar.tsx` — already done in Task 1.8

For each integration point:

1. **Session Detail — Memory tab:** Add tab to existing tab navigation. Content: query `GET /api/memory/facts?sessionId=X`. Render as FactCard list.

2. **Agent Detail — Memory section:** New section showing fact count, top entity types, link to graph view filtered by agent.

3. **MemoryPanel replacement:** Change `searchMemory()` call from `/api/claude-mem/search` to `/api/memory/facts?q=`. Update `MemoryObservation` references to `MemoryFact`.

4. **Command Palette:** Add `memory:search`, `memory:create`, `memory:graph` commands using existing CommandPalette registration pattern.

- [ ] **Steps 1-8: Implement each integration, test, commit per integration**

```bash
git commit -m "feat(web): integrate memory into sessions, agents, context picker, and command palette"
```

---

### Task 5.5: MCP Memory Tools

**Files:**
- Create: `packages/control-plane/src/mcp/memory-tools.ts`
- Create: `packages/control-plane/src/mcp/memory-tools.test.ts`

Implement 6 MCP tools following the MCP tool registration pattern used elsewhere in the codebase:

1. `memory_search` — wraps `MemorySearch.search()`, returns ranked facts as JSON
2. `memory_store` — wraps `MemoryStore.addFact()`, returns created fact
3. `memory_recall` — 2-hop BFS graph traversal from entity name, returns subgraph
4. `memory_feedback` — updates fact strength (boost/decay) based on relevance signal
5. `memory_report` — generates scoped report via LLM
6. `memory_promote` — moves fact to parent scope

Each tool: typed input schema, validation, calls existing store/search, returns structured JSON.

- [ ] **Steps 1-6: TDD cycle**

```bash
git commit -m "feat(cp): add MCP memory tools (search, store, recall, feedback, report, promote)"
```

---

### Task 5.6: Final Verification

- [ ] **Step 1: Run full monorepo build**

```bash
pnpm build
```

- [ ] **Step 2: Run all tests**

```bash
pnpm --filter @agentctl/shared test -- --run
pnpm --filter @agentctl/control-plane test -- --run
pnpm --filter @agentctl/web test -- --run
```

- [ ] **Step 3: Run lint**

```bash
npx @biomejs/biome check packages/
```

- [ ] **Step 4: Run TypeScript check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit any fixes**

- [ ] **Step 6: Update ROADMAP.md**

Mark §3.6 "Unified Memory Layer" items as completed. Add new items for memory UI to appropriate sections.

```bash
git commit -m "docs: update roadmap with memory UI completion status"
```
