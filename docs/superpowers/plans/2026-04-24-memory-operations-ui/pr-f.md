# PR F — Frontend: /memory/operations Page + 8 Alerts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `/memory/operations` page where operators can trigger, observe, and cancel jobs. `<MissingEmbeddingAlert />` mounted on 8 existing memory views. `<MixedModelsBanner />` for mixed-model detection. `<EgressConfirmationDialog />` for write-kind jobs.

**Architecture:** New components in `packages/web/src/components/memory/`. The operations page polls capabilities and jobs list. SSE streaming connects to live job progress. The sidebar gets a new nav item.

**Prerequisite:** PRs A+B+C+D+E merged. Branch from `main`.

**Branch:**
```bash
git fetch origin
git worktree add .trees/pr-f -b agent/claude-1/feat/memory-ops-pr-f
cd .trees/pr-f
```

**Version bump:** `minor` (new page for users).

---

## Files

**Create:**
- `packages/web/src/lib/api/memory-ops.ts`
- `packages/web/src/components/memory/MissingEmbeddingAlert.tsx`
- `packages/web/src/components/memory/MissingEmbeddingAlert.test.tsx`
- `packages/web/src/components/memory/MixedModelsBanner.tsx`
- `packages/web/src/components/memory/JobCard.tsx`
- `packages/web/src/components/memory/RecentJobsTable.tsx`
- `packages/web/src/components/memory/JobDetailDrawer.tsx`
- `packages/web/src/components/memory/EgressConfirmationDialog.tsx`
- `packages/web/src/views/MemoryOperationsPage.tsx`
- `packages/web/src/app/memory/operations/page.tsx`

**Modify:**
- `packages/web/src/components/memory/MemorySidebar.tsx` — add Operations nav item
- `packages/web/src/views/MemoryBrowserView.tsx` — mount alert
- `packages/web/src/views/MemoryDashboardView.tsx` — mount alert
- `packages/web/src/views/MemoryDrawersView.tsx` — mount alert
- `packages/web/src/views/MemoryMaintenancePage.tsx` — mount alert
- `packages/web/src/views/MemoryReportsView.tsx` — mount alert
- `packages/web/src/views/MemorySynthesisPage.tsx` — mount alert
- `packages/web/src/views/KnowledgeGraphView.tsx` — mount alert
- `packages/web/src/views/ConsolidationBoardView.tsx` — mount alert
- `packages/web/src/lib/api.ts` — barrel export
- `packages/web/src/lib/queries.ts` — add memory ops query keys
- `.env.example` — flip `MEMORY_OPS_ENABLED=true`

**NOT modified (no alert):**
- `packages/web/src/views/MemoryImportView.tsx`
- `packages/web/src/views/MemoryScopeManagerView.tsx`

---

## Task 1: Web API client for memory ops

**Files:**
- Create: `packages/web/src/lib/api/memory-ops.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/web/src/lib/api/memory-ops.test.ts
import { memoryOpsApi } from './memory-ops.js';

it('fetchCapabilities calls GET /api/memory/ops/capabilities', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ enabled: true, enabledKinds: ['embedding-backfill'], hasActiveProvider: true, machineId: 'm1', activeProviderModel: 'text-embedding-3-small', activeProviderLastTestOk: true, fleetJobsByKindAndScope: [] }),
  });
  const res = await memoryOpsApi.capabilities();
  expect(res.enabled).toBe(true);
  expect(res.hasActiveProvider).toBe(true);
});

it('createJobPreview calls POST /api/memory/ops/jobs/preview', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ snapshot: { rowCount: 100 }, previewToken: 'tok', expiresAt: '...' }),
  });
  const res = await memoryOpsApi.preview({ kind: 'embedding-backfill', params: {} });
  expect(res.previewToken).toBe('tok');
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/lib/api/memory-ops.test.ts
```

- [ ] **Step 3: Implement memory-ops.ts**

```typescript
// packages/web/src/lib/api/memory-ops.ts
import { request } from './core.js';
import type { MemoryOpsJob, EgressSnapshot } from '@agentctl/shared';

type Capabilities = {
  enabled: boolean;
  enabledKinds: string[];
  machineId: string;
  hasActiveProvider: boolean;
  activeProviderModel?: string;
  activeProviderLastTestOk: boolean | null;
  fleetJobsByKindAndScope: Array<{ kind: string; scope: string; queued: number; running: number; cancelling: number }>;
};

type PreviewResponse = {
  snapshot: EgressSnapshot;
  previewToken: string;
  expiresAt: string;
};

export const memoryOpsApi = {
  capabilities: () => request<Capabilities>('/api/memory/ops/capabilities'),

  listJobs: (params?: { kind?: string; status?: string; limit?: number; localOnly?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.localOnly) qs.set('localOnly', 'true');
    return request<{ jobs: MemoryOpsJob[] }>(`/api/memory/ops/jobs${qs.size ? `?${qs}` : ''}`);
  },

  getJob: (id: string) => request<{ job: MemoryOpsJob }>(`/api/memory/ops/jobs/${id}`),

  preview: (body: { kind: string; params: Record<string, unknown> }) =>
    request<PreviewResponse>('/api/memory/ops/jobs/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  createJob: (body: { kind: string; egressConfirmed: boolean; previewToken?: string; params: Record<string, unknown> }) =>
    request<{ job: MemoryOpsJob }>('/api/memory/ops/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  cancelJob: (id: string) =>
    request<{ status: string; job: MemoryOpsJob }>(`/api/memory/ops/jobs/${id}/cancel`, { method: 'POST' }),

  streamUrl: (id: string) => `/api/memory/ops/jobs/${id}/stream`,
};
```

- [ ] **Step 4: Update barrel + queries**

In `packages/web/src/lib/api.ts`:
```typescript
export { memoryOpsApi } from './api/memory-ops.js';
```

In `packages/web/src/lib/queries.ts`:
```typescript
// Add to queryKeys.memory:
ops: {
  capabilities: () => ['memory', 'ops', 'capabilities'] as const,
  jobs: (filters?: object) => ['memory', 'ops', 'jobs', filters] as const,
  job: (id: string) => ['memory', 'ops', 'job', id] as const,
},

export const memoryOpsCapabilitiesQuery = () => ({
  queryKey: queryKeys.memory.ops.capabilities(),
  queryFn: () => memoryOpsApi.capabilities(),
  refetchInterval: 5_000,
});

export const memoryOpsJobsQuery = (filters?: Parameters<typeof memoryOpsApi.listJobs>[0]) => ({
  queryKey: queryKeys.memory.ops.jobs(filters),
  queryFn: () => memoryOpsApi.listJobs(filters),
  refetchInterval: 3_000,
});
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm vitest run src/lib/api/memory-ops.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/api/memory-ops.ts packages/web/src/lib/api/memory-ops.test.ts packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(memory-ops): web API client for memory ops + query helpers"
```

---

## Task 2: MissingEmbeddingAlert component

**Files:**
- Create: `packages/web/src/components/memory/MissingEmbeddingAlert.tsx`
- Create: `packages/web/src/components/memory/MissingEmbeddingAlert.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/web/src/components/memory/MissingEmbeddingAlert.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MissingEmbeddingAlert } from './MissingEmbeddingAlert.js';

const wrapper = ({ children }: React.PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

it('renders nothing while providers query is pending', () => {
  vi.mocked(memoryProvidersApi.list).mockImplementation(() => new Promise(() => {})); // never resolves
  const { container } = render(<MissingEmbeddingAlert />, { wrapper });
  expect(container.firstChild).toBeNull();
});

it('renders alert when no providers configured', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({ providers: [] });
  render(<MissingEmbeddingAlert />, { wrapper });
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByText(/no embedding provider/i)).toBeInTheDocument();
});

it('renders nothing when active provider with lastTestOk=true', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({
    providers: [{ ..., isActive: true, metadata: { lastTestOk: true, ... } }],
  });
  const { container } = render(<MissingEmbeddingAlert />, { wrapper });
  await waitFor(() => {});
  expect(container.firstChild).toBeNull();
});

it('renders alert with passive-peer copy when hasActiveProvider=false on capabilities', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({ providers: [] });
  vi.mocked(memoryOpsApi.capabilities).mockResolvedValue({ hasActiveProvider: false, ... });
  render(<MissingEmbeddingAlert showPeerNote />, { wrapper });
  await waitFor(() => expect(screen.getByText(/configure one to run jobs here/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/components/memory/MissingEmbeddingAlert.test.tsx
```

- [ ] **Step 3: Implement MissingEmbeddingAlert**

```typescript
// packages/web/src/components/memory/MissingEmbeddingAlert.tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { memoryProvidersQuery } from '../../lib/queries.js';

type Props = {
  showPeerNote?: boolean; // show passive-peer copy on /memory/operations
};

export function MissingEmbeddingAlert({ showPeerNote }: Props) {
  const { data, isPending, isError } = useQuery(memoryProvidersQuery());

  // Render nothing while loading or on error — don't flash alert
  if (isPending || isError) return null;

  const providers = data?.providers ?? [];
  const activeProvider = providers.find(p => p.isActive);
  const needsAlert =
    providers.length === 0 ||
    (activeProvider !== undefined && activeProvider.metadata.lastTestOk === false) ||
    (activeProvider !== undefined && activeProvider.metadata.lastTestOk === null && providers.length > 0 && !activeProvider.metadata.lastTestedAt);

  if (!needsAlert && activeProvider?.metadata.lastTestOk === true) return null;
  if (!needsAlert && providers.length > 0) return null;

  const message = showPeerNote
    ? 'No embedding provider is configured on this machine. Configure one to run jobs here; remote jobs can still be viewed.'
    : providers.length === 0
      ? 'No embedding provider configured. Go to Settings → Memory & Embeddings to add one and enable vector search.'
      : activeProvider?.metadata.lastTestOk === false
        ? `Provider test failed: ${activeProvider.metadata.lastTestError ?? 'unknown error'}. Update the provider in Settings.`
        : 'Embedding provider not yet tested. Test it in Settings → Memory & Embeddings.';

  return (
    <div role="alert" className="rounded border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-300 mb-4">
      {message}
      {!showPeerNote && (
        <a href="/settings#memory-embeddings" className="ml-2 underline text-amber-200">
          Go to Settings
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/components/memory/MissingEmbeddingAlert.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/memory/MissingEmbeddingAlert.tsx packages/web/src/components/memory/MissingEmbeddingAlert.test.tsx
git commit -m "feat(memory-ops): MissingEmbeddingAlert — renders only when providers absent/broken, isPending guard"
```

---

## Task 3: Mount alert on 8 views

**Files:**
- Modify: 8 view files (listed above)

- [ ] **Step 1: Write test for MemoryBrowserView alert mount**

```typescript
// Add to packages/web/src/views/MemoryBrowserView.test.tsx:
it('renders MissingEmbeddingAlert', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({ providers: [] });
  render(<MemoryBrowserView />, { wrapper });
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/views/MemoryBrowserView.test.tsx
```

- [ ] **Step 3: Add MissingEmbeddingAlert to MemoryBrowserView**

```typescript
// In packages/web/src/views/MemoryBrowserView.tsx, at the top of the JSX return:
import { MissingEmbeddingAlert } from '../components/memory/MissingEmbeddingAlert.js';

// Inside return:
<>
  <MissingEmbeddingAlert />
  {/* existing content */}
</>
```

- [ ] **Step 4: Repeat for the other 7 views**

Apply the same one-line import + mount pattern to:
- `MemoryDashboardView.tsx`
- `MemoryDrawersView.tsx`
- `MemoryMaintenancePage.tsx`
- `MemoryReportsView.tsx`
- `MemorySynthesisPage.tsx`
- `KnowledgeGraphView.tsx`
- `ConsolidationBoardView.tsx`

DO NOT add the alert to `MemoryImportView.tsx` or `MemoryScopeManagerView.tsx`.

- [ ] **Step 5: Verify the two views WITHOUT alert don't have it**

```typescript
// Add to MemoryImportView.test.tsx:
it('does NOT render MissingEmbeddingAlert', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({ providers: [] });
  render(<MemoryImportView />, { wrapper });
  await new Promise(r => setTimeout(r, 100));
  expect(screen.queryByRole('alert')).toBeNull();
});
```

- [ ] **Step 6: Run all view tests**

```bash
pnpm vitest run src/views/
# Expected: PASS — alert appears on 8, absent on 2
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/views/
git commit -m "feat(memory-ops): mount MissingEmbeddingAlert on 8 memory views (not Import or ScopeManager)"
```

---

## Task 4: JobCard, RecentJobsTable, EgressConfirmationDialog, MixedModelsBanner

**Files:**
- Create: `packages/web/src/components/memory/JobCard.tsx`
- Create: `packages/web/src/components/memory/RecentJobsTable.tsx`
- Create: `packages/web/src/components/memory/JobDetailDrawer.tsx`
- Create: `packages/web/src/components/memory/EgressConfirmationDialog.tsx`
- Create: `packages/web/src/components/memory/MixedModelsBanner.tsx`

- [ ] **Step 1: Write failing tests for JobCard**

```typescript
// packages/web/src/components/memory/JobCard.test.tsx
import { render, screen } from '@testing-library/react';
import { JobCard } from './JobCard.js';

const mockCapabilities = {
  enabled: true, enabledKinds: ['embedding-backfill'], hasActiveProvider: true,
  activeProviderModel: 'text-embedding-3-small', activeProviderLastTestOk: true,
  fleetJobsByKindAndScope: [],
  machineId: 'm1',
};

it('Run button is disabled when no active provider', () => {
  render(<JobCard kind="embedding-backfill" scope="" capabilities={{ ...mockCapabilities, hasActiveProvider: false }} onRun={vi.fn()} />);
  expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
});

it('Run button is disabled when fleet has active job for same kind+scope', () => {
  const caps = { ...mockCapabilities, fleetJobsByKindAndScope: [{ kind: 'embedding-backfill', scope: '', queued: 1, running: 0, cancelling: 0 }] };
  render(<JobCard kind="embedding-backfill" scope="" capabilities={caps} onRun={vi.fn()} />);
  expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
});

it('Run button enabled when all conditions met', () => {
  render(<JobCard kind="embedding-backfill" scope="" capabilities={mockCapabilities} onRun={vi.fn()} />);
  expect(screen.getByRole('button', { name: /run/i })).not.toBeDisabled();
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/components/memory/JobCard.test.tsx
```

- [ ] **Step 3: Implement JobCard**

```typescript
// packages/web/src/components/memory/JobCard.tsx
'use client';

type Capabilities = {
  enabled: boolean;
  enabledKinds: string[];
  hasActiveProvider: boolean;
  activeProviderLastTestOk: boolean | null;
  fleetJobsByKindAndScope: Array<{ kind: string; scope: string; queued: number; running: number; cancelling: number }>;
  machineId: string;
};

type Props = {
  kind: string;
  scope: string;
  capabilities: Capabilities;
  onRun: () => void;
};

const KIND_LABELS: Record<string, string> = {
  'embedding-backfill': 'Embedding Backfill',
  'drawer-backfill': 'Drawer Backfill',
  'consolidation': 'Consolidation',
  'synthesis': 'Synthesis',
};

const REQUIRES_PROVIDER_KINDS = new Set(['embedding-backfill', 'drawer-backfill']);

export function JobCard({ kind, scope, capabilities, onRun }: Props) {
  const isEnabled = capabilities.enabled && capabilities.enabledKinds.includes(kind);

  const fleetActive = capabilities.fleetJobsByKindAndScope.some(
    f => f.kind === kind && f.scope === scope && f.queued + f.running + f.cancelling > 0,
  );

  const providerOk = !REQUIRES_PROVIDER_KINDS.has(kind) ||
    (capabilities.hasActiveProvider && capabilities.activeProviderLastTestOk !== false);

  const disabled = !isEnabled || fleetActive || !providerOk;

  let disabledReason = '';
  if (!isEnabled) disabledReason = 'This job kind is not enabled';
  else if (!providerOk) disabledReason = 'No active embedding provider (or last test failed)';
  else if (fleetActive) disabledReason = 'A job of this kind is already running in the fleet';

  return (
    <div className="rounded border border-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-sm font-medium">{KIND_LABELS[kind] ?? kind}</span>
          {scope && <span className="ml-2 text-xs text-neutral-400">scope: {scope}</span>}
          {disabledReason && <p className="text-xs text-neutral-500 mt-1">{disabledReason}</p>}
        </div>
        <button
          onClick={onRun}
          disabled={disabled}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Run
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement EgressConfirmationDialog**

```typescript
// packages/web/src/components/memory/EgressConfirmationDialog.tsx
'use client';
import { useState } from 'react';
import type { EgressSnapshot } from '@agentctl/shared';

type Props = {
  open: boolean;
  snapshot: EgressSnapshot;
  previewToken: string;
  onConfirm: (previewToken: string) => void;
  onCancel: () => void;
};

export function EgressConfirmationDialog({ open, snapshot, previewToken, onConfirm, onCancel }: Props) {
  const [checked, setChecked] = useState(false);
  if (!open) return null;

  return (
    <div role="dialog" className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-6 max-w-md w-full">
        <h2 className="text-sm font-semibold mb-4">Confirm Data Egress</h2>
        <dl className="text-xs space-y-1 mb-4">
          <div><dt className="text-neutral-400 inline">Destination:</dt> <dd className="inline">{snapshot.providerHost}</dd></div>
          <div><dt className="text-neutral-400 inline">Model:</dt> <dd className="inline">{snapshot.providerModel}</dd></div>
          <div><dt className="text-neutral-400 inline">Content:</dt> <dd className="inline">{snapshot.contentClass}</dd></div>
          {snapshot.rowCount !== undefined && <div><dt className="text-neutral-400 inline">Facts:</dt> <dd className="inline">{snapshot.rowCount.toLocaleString()}</dd></div>}
          {snapshot.fileCount !== undefined && <div><dt className="text-neutral-400 inline">Files:</dt> <dd className="inline">{snapshot.fileCount.toLocaleString()}</dd></div>}
          <div><dt className="text-neutral-400 inline">Token estimate:</dt> <dd className="inline">{(snapshot.tokenEstimate / 1000).toFixed(1)}K</dd></div>
          <div><dt className="text-neutral-400 inline">Cost estimate:</dt> <dd className="inline">${snapshot.costEstimate.toFixed(4)}</dd></div>
        </dl>
        <label className="flex items-center gap-2 text-xs mb-4">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
          I confirm that sending this data to {snapshot.providerHost} is acceptable.
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="text-xs px-3 py-1 rounded border border-neutral-600">Cancel</button>
          <button
            onClick={() => onConfirm(previewToken)}
            disabled={!checked}
            className="text-xs px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-40"
          >
            Confirm & Run
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement MixedModelsBanner**

```typescript
// packages/web/src/components/memory/MixedModelsBanner.tsx
'use client';

type Props = {
  models: Array<{ table: string; model: string; count: number }>;
  activeModel: string;
};

export function MixedModelsBanner({ models, activeModel }: Props) {
  if (models.length <= 1) return null;
  return (
    <div className="rounded border border-orange-800 bg-orange-950/30 px-4 py-3 text-sm text-orange-300 mb-4">
      Memory facts were embedded with different models. Vector search is restricted to <strong>{activeModel}</strong>.
      The re-embed-all job is not yet available in v1; use the manual SQL workaround in /docs.
    </div>
  );
}
```

- [ ] **Step 6: Run all component tests**

```bash
pnpm vitest run src/components/memory/
# Expected: PASS
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/memory/JobCard.tsx packages/web/src/components/memory/RecentJobsTable.tsx packages/web/src/components/memory/JobDetailDrawer.tsx packages/web/src/components/memory/EgressConfirmationDialog.tsx packages/web/src/components/memory/MixedModelsBanner.tsx
git commit -m "feat(memory-ops): JobCard, RecentJobsTable, EgressConfirmationDialog, MixedModelsBanner components"
```

---

## Task 5: MemoryOperationsPage + routing + sidebar

**Files:**
- Create: `packages/web/src/views/MemoryOperationsPage.tsx`
- Create: `packages/web/src/app/memory/operations/page.tsx`
- Modify: `packages/web/src/components/memory/MemorySidebar.tsx`

- [ ] **Step 1: Check existing MemorySidebar structure**

```bash
grep -n "MEMORY_NAV_ITEMS\|href\|operations" packages/web/src/components/memory/MemorySidebar.tsx | head -10
```

Identify where to add the Operations item. The spec says `MEMORY_NAV_ITEMS` is at line 13 of `MemorySidebar.tsx`.

- [ ] **Step 2: Add Operations to sidebar nav**

In `MemorySidebar.tsx`, add to `MEMORY_NAV_ITEMS`:
```typescript
{ label: 'Operations', href: '/memory/operations', icon: TerminalSquareIcon },
```

Use whatever icon is consistent with the existing nav items (check surrounding entries).

- [ ] **Step 3: Implement MemoryOperationsPage**

```typescript
// packages/web/src/views/MemoryOperationsPage.tsx
'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryOpsCapabilitiesQuery, memoryOpsJobsQuery } from '../lib/queries.js';
import { memoryOpsApi } from '../lib/api/memory-ops.js';
import { MissingEmbeddingAlert } from '../components/memory/MissingEmbeddingAlert.js';
import { JobCard } from '../components/memory/JobCard.js';
import { RecentJobsTable } from '../components/memory/RecentJobsTable.js';
import { EgressConfirmationDialog } from '../components/memory/EgressConfirmationDialog.js';
import { ApiError } from '../lib/api/core.js';
import type { EgressSnapshot } from '@agentctl/shared';

const JOB_KINDS = ['embedding-backfill', 'drawer-backfill', 'consolidation', 'synthesis'] as const;

export function MemoryOperationsPage() {
  const qc = useQueryClient();
  const { data: caps } = useQuery(memoryOpsCapabilitiesQuery());
  const { data: jobsData } = useQuery(memoryOpsJobsQuery({ limit: 20 }));

  const [egressState, setEgressState] = useState<{
    open: boolean;
    kind: string;
    snapshot: EgressSnapshot | null;
    previewToken: string;
  }>({ open: false, kind: '', snapshot: null, previewToken: '' });
  const [error, setError] = useState<string | null>(null);

  const createJobMutation = useMutation({
    mutationFn: memoryOpsApi.createJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memory', 'ops', 'jobs'] });
      setEgressState(s => ({ ...s, open: false }));
    },
    onError: (err) => {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Failed to create job');
    },
  });

  async function handleRun(kind: string) {
    setError(null);
    // For write kinds that require egress confirmation, get preview first
    if (kind === 'embedding-backfill' || kind === 'drawer-backfill') {
      try {
        const preview = await memoryOpsApi.preview({ kind, params: {} });
        setEgressState({ open: true, kind, snapshot: preview.snapshot, previewToken: preview.previewToken });
      } catch (err) {
        setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Preview failed');
      }
    } else {
      // No egress confirmation needed for consolidation/synthesis
      createJobMutation.mutate({ kind, egressConfirmed: false, params: {} });
    }
  }

  async function handleConfirmEgress(previewToken: string) {
    createJobMutation.mutate({
      kind: egressState.kind,
      egressConfirmed: true,
      previewToken,
      params: {},
    });
  }

  const capabilities = caps ?? { enabled: false, enabledKinds: [], hasActiveProvider: false, activeProviderLastTestOk: null, fleetJobsByKindAndScope: [], machineId: '' };

  return (
    <div className="space-y-6">
      <h1 className="text-base font-semibold">Memory Operations</h1>
      <MissingEmbeddingAlert showPeerNote />
      {error && <div className="rounded border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-300">{error}</div>}

      <div className="grid gap-3">
        {JOB_KINDS.map(kind => (
          <JobCard
            key={kind}
            kind={kind}
            scope=""
            capabilities={capabilities}
            onRun={() => handleRun(kind)}
          />
        ))}
      </div>

      <div>
        <h2 className="text-sm font-medium mb-2">Recent Jobs</h2>
        <RecentJobsTable jobs={jobsData?.jobs ?? []} machineId={capabilities.machineId} />
      </div>

      {egressState.open && egressState.snapshot && (
        <EgressConfirmationDialog
          open
          snapshot={egressState.snapshot}
          previewToken={egressState.previewToken}
          onConfirm={handleConfirmEgress}
          onCancel={() => setEgressState(s => ({ ...s, open: false }))}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create Next.js page file**

```typescript
// packages/web/src/app/memory/operations/page.tsx
import { MemoryOperationsPage } from '../../../views/MemoryOperationsPage.js';
export default function Page() { return <MemoryOperationsPage />; }
```

- [ ] **Step 5: Update .env.example**

Change `MEMORY_OPS_ENABLED=false` to `MEMORY_OPS_ENABLED=true` in `.env.example`.

- [ ] **Step 6: Build check + manual verification**

```bash
pnpm build
# Expected: 0 TypeScript errors

# Start dev-1:
source .env.dev-1
pm2 restart agentctl-web-dev1
# Open http://localhost:5273/memory/operations
# Verify: Operations link in memory sidebar
# Verify: JobCards render with correct disabled states
# Verify: clicking Run on embedding-backfill opens egress dialog
# Verify: confirming egress creates a job and shows it in the table
```

- [ ] **Step 7: Commit + push + open PR**

```bash
git add packages/web/src/
git commit -m "feat(memory-ops): /memory/operations page with job cards, egress confirmation, and 8-view alerts"
git push origin agent/claude-1/feat/memory-ops-pr-f
gh pr create --base main \
  --title "feat(memory-ops): PR F — /memory/operations page + MissingEmbeddingAlert on 8 views" \
  --body "Operators can trigger, observe, and cancel jobs from /memory/operations. Alert appears on 8 memory views when no provider configured. Egress confirmation flow via preview endpoint."
```
