# PR C — Frontend: Settings → Memory & Embeddings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status (2026-04-25):** Landed in PR #806. Follow-up PR #807 persisted saved-provider test success/failure metadata so row-level Test results survive list refreshes and new sessions. Follow-up PR #808 avoided raw upstream error persistence/display, credential-guarded metadata writes, and cleared transient overrides after provider refetch.

**Goal:** Settings UI section for configuring embedding providers. ApiError gains `details` field so all new error codes surface correctly in the UI. Test-before-save flow via `/test-ephemeral`. Provider list shows only `verified:true` catalog entries.

**Architecture:** New `MemoryEmbeddingsSection` component registers in `SettingsView`. The web API client (`core.ts`) parses `body.details` from error responses and stores it on `ApiError`. Provider CRUD calls go through new `api/memory-providers.ts` module.

**Prerequisite:** PR B merged to `main`. Branch from `main`.

**Branch:**
```bash
git fetch origin
git worktree add .trees/pr-c -b agent/claude-1/feat/memory-ops-pr-c
cd .trees/pr-c
```

**Tech Stack:** Next.js 15 App Router, React Query (`@tanstack/react-query`), Tailwind CSS, shadcn/ui components (matching existing settings patterns), Vitest + React Testing Library.

**Version bump:** `minor` (new UI surface for users).

---

## Files

**Modify:**
- `packages/web/src/lib/api/core.ts` — ApiError gains `details?`, `request<T>()` parses `body.details`

**Create:**
- `packages/web/src/lib/api/memory-providers.ts`
- `packages/web/src/components/memory/ProviderDialog.tsx`
- `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`
- `packages/web/src/components/memory/ProviderDialog.test.tsx`
- `packages/web/src/views/settings/MemoryEmbeddingsSection.test.tsx`

**Modify:**
- `packages/web/src/views/SettingsView.tsx` — register new section
- `packages/web/src/lib/api.ts` — barrel export
- `packages/web/src/lib/queries.ts` — add `queryKeys.memory.*` entries

---

## Task 1: ApiError.details + core.ts

**Files:**
- Modify: `packages/web/src/lib/api/core.ts`

Current `ApiError` (lines 7–17):
```typescript
export class ApiError extends Error {
  public hint?: string;
  // ...
  constructor(public status: number, public code: string, message: string, hint?: string) {
    ...
    this.hint = hint;
  }
}
// request() line 40: (body as Record<string, string>).hint
```

- [ ] **Step 1: Write failing test**

```typescript
// packages/web/src/lib/api/core.test.ts (or add to existing)
import { ApiError, request } from './core.js';

it('ApiError stores details field', () => {
  const err = new ApiError(409, 'JOB_ALREADY_RUNNING', 'msg', undefined, { existingJobId: 'j1', existingMachine: 'm1' });
  expect(err.details).toEqual({ existingJobId: 'j1', existingMachine: 'm1' });
});

it('request parses body.details into ApiError.details', async () => {
  // mock fetch to return 409 with details
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: 'JOB_ALREADY_RUNNING', message: 'job running', details: { existingJobId: 'uuid-1' } }),
  });
  await expect(request('/api/anything')).rejects.toMatchObject({
    code: 'JOB_ALREADY_RUNNING',
    details: { existingJobId: 'uuid-1' },
  });
});

it('request still parses body.hint for backward compatibility', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false, status: 400,
    json: async () => ({ error: 'OLD_CODE', message: 'msg', hint: 'old hint' }),
  });
  await expect(request('/api/anything')).rejects.toMatchObject({ hint: 'old hint' });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd packages/web
pnpm vitest run src/lib/api/core.test.ts
# Expected: FAIL — ApiError has no details; request doesn't parse details
```

- [ ] **Step 3: Update ApiError and request()**

```typescript
// packages/web/src/lib/api/core.ts

export class ApiError extends Error {
  public hint?: string;
  public details?: Record<string, unknown>;

  constructor(
    public status: number,
    public code: string,
    message: string,
    hint?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.hint = hint;
    this.details = details;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // ... existing fetch logic ...
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as Record<string, string>).error ?? 'UNKNOWN_ERROR',
      (body as Record<string, string>).message ?? res.statusText,
      (body as Record<string, string>).hint,           // backward compat
      (body as Record<string, unknown>).details as Record<string, unknown> | undefined,
    );
  }
  // ... rest unchanged
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/lib/api/core.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api/core.ts packages/web/src/lib/api/core.test.ts
git commit -m "feat(memory-ops): ApiError.details field + core.ts parses body.details from error responses"
```

---

## Task 2: Web API client for providers

**Files:**
- Create: `packages/web/src/lib/api/memory-providers.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/web/src/lib/api/memory-providers.test.ts
import { fetchProviders, createProvider, deleteProvider } from './memory-providers.js';

it('fetchProviders calls GET /api/memory/providers', async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ providers: [{ id: 'p1', name: 'Test', provider: 'openai' }] }),
  });
  globalThis.fetch = mockFetch;
  const result = await fetchProviders();
  expect(mockFetch).toHaveBeenCalledWith('/api/memory/providers', expect.any(Object));
  expect(result.providers[0].id).toBe('p1');
});

it('testEphemeral calls POST /api/memory/providers/test-ephemeral', async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ ok: true, dim: 1536, model: 'text-embedding-3-small', costUsd: 0.001, latencyMs: 120, signedToken: 'tok.sig' }),
  });
  globalThis.fetch = mockFetch;
  const res = await testEphemeral({ provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-x' });
  expect(res.dim).toBe(1536);
  expect(res.signedToken).toBe('tok.sig');
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/lib/api/memory-providers.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement memory-providers.ts**

```typescript
// packages/web/src/lib/api/memory-providers.ts
import { request } from './core.js';
import type { EmbeddingProvider, EgressSnapshot } from '@agentctl/shared';

export type TestEphemeralResult = {
  ok: boolean;
  dim: number;
  model: string;
  costUsd: number;
  latencyMs: number;
  signedToken: string;
};

export type CreateProviderBody = {
  name: string;
  provider: 'openai' | 'gemini';
  model: string;
  apiKey: string;
  active?: boolean;
  recentTestResult?: { signedToken: string; apiKey: string };
};

export const memoryProvidersApi = {
  list: () =>
    request<{ providers: EmbeddingProvider[] }>('/api/memory/providers'),

  create: (body: CreateProviderBody) =>
    request<{ provider: EmbeddingProvider }>('/api/memory/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  update: (id: string, body: Partial<CreateProviderBody>) =>
    request<{ provider: EmbeddingProvider }>(`/api/memory/providers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/memory/providers/${id}`, { method: 'DELETE' }),

  testEphemeral: (body: { provider: string; model: string; apiKey: string }) =>
    request<TestEphemeralResult>('/api/memory/providers/test-ephemeral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  testSaved: (id: string) =>
    request<{ ok: boolean; dim: number; model: string; costUsd: number; latencyMs: number }>(
      `/api/memory/providers/${id}/test`,
      { method: 'POST' },
    ),
};
```

- [ ] **Step 4: Add to barrel exports and queries**

In `packages/web/src/lib/api.ts`:
```typescript
export { memoryProvidersApi } from './api/memory-providers.js';
```

In `packages/web/src/lib/queries.ts`, add:
```typescript
export const queryKeys = {
  // ... existing
  memory: {
    providers: () => ['memory', 'providers'] as const,
    providerDetail: (id: string) => ['memory', 'providers', id] as const,
  },
};

export const memoryProvidersQuery = () => ({
  queryKey: queryKeys.memory.providers(),
  queryFn: () => memoryProvidersApi.list(),
});
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm vitest run src/lib/api/memory-providers.test.ts
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/api/memory-providers.ts packages/web/src/lib/api/memory-providers.test.ts packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(memory-ops): web API client for memory providers + query helpers"
```

---

## Task 3: ProviderDialog component

**Files:**
- Create: `packages/web/src/components/memory/ProviderDialog.tsx`
- Create: `packages/web/src/components/memory/ProviderDialog.test.tsx`

This dialog handles both Add and Edit flows. Test-before-save calls `/test-ephemeral`; the `signedToken` is stored in component state and submitted with the CREATE/PATCH.

- [ ] **Step 1: Write failing tests**

```typescript
// packages/web/src/components/memory/ProviderDialog.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProviderDialog } from './ProviderDialog.js';

const mockOnClose = vi.fn();
const mockOnSave = vi.fn();

it('shows only verified providers in the dropdown', () => {
  render(<ProviderDialog open onClose={mockOnClose} onSave={mockOnSave} />);
  // "gemini" should not appear in provider options (verified:false)
  const options = screen.queryAllByRole('option');
  expect(options.find(o => o.textContent?.toLowerCase().includes('gemini'))).toBeUndefined();
});

it('shows test button and enables save after successful test', async () => {
  vi.mocked(memoryProvidersApi.testEphemeral).mockResolvedValue({
    ok: true, dim: 1536, model: 'text-embedding-3-small', costUsd: 0.0001, latencyMs: 85, signedToken: 'tok.sig',
  });
  render(<ProviderDialog open onClose={mockOnClose} onSave={mockOnSave} />);
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-test' } });
  fireEvent.click(screen.getByRole('button', { name: /test/i }));
  await waitFor(() => expect(screen.getByText(/dim.*1536/i)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
});

it('shows machine-local warning banner', () => {
  render(<ProviderDialog open onClose={mockOnClose} onSave={mockOnSave} />);
  expect(screen.getByText(/only available on this machine/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/components/memory/ProviderDialog.test.tsx
# Expected: FAIL — component not found
```

- [ ] **Step 3: Implement ProviderDialog**

```typescript
// packages/web/src/components/memory/ProviderDialog.tsx
'use client';
import { useState } from 'react';
import { EMBEDDING_MODEL_CATALOG } from '@agentctl/shared';
import { memoryProvidersApi, type TestEphemeralResult, type CreateProviderBody } from '../../lib/api/memory-providers.js';
import { ApiError } from '../../lib/api/core.js';
// Import shadcn/ui Dialog, Button, Input, Select matching the existing settings dialog pattern
// (check packages/web/src/components/ui/ for available components)

const VERIFIED_PROVIDERS = EMBEDDING_MODEL_CATALOG.filter(e => e.verified);

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (provider: CreateProviderBody & { recentTestResult?: { signedToken: string; apiKey: string } }) => Promise<void>;
  initial?: { id: string; name: string; provider: string; model: string; isActive: boolean };
};

export function ProviderDialog({ open, onClose, onSave, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [provider, setProvider] = useState<'openai'>(initial?.provider as 'openai' ?? 'openai');
  const [model, setModel] = useState(initial?.model ?? VERIFIED_PROVIDERS[0]?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [active, setActive] = useState(initial?.isActive ?? false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestEphemeralResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await memoryProvidersApi.testEphemeral({ provider, model, apiKey });
      setTestResult(res);
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        name, provider, model, apiKey, active,
        recentTestResult: testResult ? { signedToken: testResult.signedToken, apiKey } : undefined,
      });
      onClose();
    } catch (err) {
      // Error displayed by parent
    } finally {
      setSaving(false);
    }
  }

  // Only show verified providers in the select
  const providerOptions = [...new Set(VERIFIED_PROVIDERS.map(e => e.provider))];
  const modelOptions = VERIFIED_PROVIDERS.filter(e => e.provider === provider).map(e => e.model);

  return (
    // Use existing Dialog pattern from settings components
    <div role="dialog" aria-modal>
      <div className="text-sm text-amber-400 bg-amber-950/30 rounded p-2 mb-4">
        This provider will only be available on this machine.
      </div>
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={e => setName(e.target.value)} />
      <label>Provider</label>
      <select value={provider} onChange={e => setProvider(e.target.value as 'openai')}>
        {providerOptions.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <label>Model</label>
      <select value={model} onChange={e => setModel(e.target.value)}>
        {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <label htmlFor="apiKey">API Key</label>
      <input id="apiKey" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={initial ? '(leave blank to keep current)' : ''} />
      {testResult && (
        <p className="text-green-400 text-sm">
          OK · dim {testResult.dim} · {testResult.latencyMs}ms · ${testResult.costUsd.toFixed(6)}
        </p>
      )}
      {testError && <p className="text-red-400 text-sm">{testError}</p>}
      <label>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        Set as active provider
      </label>
      <div className="flex gap-2 mt-4">
        <button onClick={handleTest} disabled={!apiKey || testing} type="button">
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose} type="button">Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/components/memory/ProviderDialog.test.tsx
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/memory/ProviderDialog.tsx packages/web/src/components/memory/ProviderDialog.test.tsx
git commit -m "feat(memory-ops): ProviderDialog — test-before-save, verified-only catalog, machine-local banner"
```

---

## Task 4: MemoryEmbeddingsSection + SettingsView registration

**Files:**
- Create: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`
- Create: `packages/web/src/views/settings/MemoryEmbeddingsSection.test.tsx`
- Modify: `packages/web/src/views/SettingsView.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/web/src/views/settings/MemoryEmbeddingsSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryEmbeddingsSection } from './MemoryEmbeddingsSection.js';

const wrapper = ({ children }: React.PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

it('shows "No providers configured" when list is empty', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({ providers: [] });
  render(<MemoryEmbeddingsSection />, { wrapper });
  await waitFor(() => expect(screen.getByText(/no providers configured/i)).toBeInTheDocument());
});

it('shows provider card with active badge', async () => {
  vi.mocked(memoryProvidersApi.list).mockResolvedValue({
    providers: [{ id: 'p1', name: 'My OpenAI', provider: 'openai', model: 'text-embedding-3-small',
      isActive: true, apiKeyLast4: '1234', metadata: { lastTestOk: true, lastTestError: null, lastTestedAt: null, dim: 1536, latencyMs: 90, costUsd: null }, createdAt: '', updatedAt: '' }],
  });
  render(<MemoryEmbeddingsSection />, { wrapper });
  await waitFor(() => expect(screen.getByText('My OpenAI')).toBeInTheDocument());
  expect(screen.getByText(/active/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/views/settings/MemoryEmbeddingsSection.test.tsx
# Expected: FAIL — component not found
```

- [ ] **Step 3: Implement MemoryEmbeddingsSection**

```typescript
// packages/web/src/views/settings/MemoryEmbeddingsSection.tsx
'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryProvidersApi } from '../../lib/api/memory-providers.js';
import { memoryProvidersQuery, queryKeys } from '../../lib/queries.js';
import { ProviderDialog } from '../../components/memory/ProviderDialog.js';
import type { EmbeddingProvider } from '@agentctl/shared';
import { ApiError } from '../../lib/api/core.js';

export function MemoryEmbeddingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(memoryProvidersQuery());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmbeddingProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: memoryProvidersApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.memory.providers() }),
    onError: (err) => setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: memoryProvidersApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.memory.providers() }),
  });

  const providers = data?.providers ?? [];

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Embedding Providers</h3>
        <button onClick={() => { setEditTarget(null); setDialogOpen(true); }} className="text-xs">
          + Add Provider
        </button>
      </div>
      {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
      {isLoading && <p className="text-neutral-500 text-sm">Loading…</p>}
      {!isLoading && providers.length === 0 && (
        <p className="text-neutral-500 text-sm">No providers configured. Add one to enable vector search and memory backfill.</p>
      )}
      <ul className="space-y-2">
        {providers.map(p => (
          <li key={p.id} className="flex items-center justify-between rounded border border-neutral-800 p-3">
            <div>
              <span className="font-mono text-sm">{p.name}</span>
              <span className="ml-2 text-xs text-neutral-400">{p.provider}/{p.model}</span>
              {p.isActive && <span className="ml-2 text-xs text-green-400 uppercase">Active</span>}
              {p.metadata.lastTestOk === false && <span className="ml-2 text-xs text-red-400">Test failed</span>}
              {p.apiKeyLast4 && <span className="ml-2 text-xs text-neutral-500">Key: ···{p.apiKeyLast4}</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setEditTarget(p); setDialogOpen(true); }} className="text-xs">Edit</button>
              <button onClick={() => deleteMutation.mutate(p.id)} className="text-xs text-red-400">Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {dialogOpen && (
        <ProviderDialog
          open
          onClose={() => setDialogOpen(false)}
          initial={editTarget ?? undefined}
          onSave={async (body) => {
            if (editTarget) {
              await memoryProvidersApi.update(editTarget.id, body);
              qc.invalidateQueries({ queryKey: queryKeys.memory.providers() });
            } else {
              await createMutation.mutateAsync(body);
            }
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Register in SettingsView.tsx**

Open `packages/web/src/views/SettingsView.tsx`. Find the section list (around line 26–67). Add a new section entry following the existing pattern:

```typescript
// Import at top of SettingsView.tsx:
import { MemoryEmbeddingsSection } from './settings/MemoryEmbeddingsSection.js';

// Add to sections array (following existing pattern, e.g. after the Privacy section):
{
  id: 'memory-embeddings',
  label: 'Memory & Embeddings',
  component: <MemoryEmbeddingsSection />,
},
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm vitest run src/views/settings/MemoryEmbeddingsSection.test.tsx
# Expected: PASS
```

- [ ] **Step 6: Build check**

```bash
pnpm build
# Expected: 0 TypeScript errors
```

- [ ] **Step 7: Manual verification in dev-1**

```bash
source .env.dev-1 && pm2 start infra/pm2/ecosystem.dev1.config.cjs
# Open http://localhost:5273/settings
# Navigate to Memory & Embeddings section
# Verify: section appears, Add button visible, empty state text shown
# Add an OpenAI provider: fill name + key → Test → verify dim=1536 appears → Save
# Verify: provider appears in list with "Active" badge
```

- [ ] **Step 8: Commit + push + open PR**

```bash
git add packages/web/src/
git commit -m "feat(memory-ops): Settings → Memory & Embeddings section with provider CRUD and test-before-save"
git push origin agent/claude-1/feat/memory-ops-pr-c
gh pr create --base main \
  --title "feat(memory-ops): PR C — Settings → Memory & Embeddings UI" \
  --body "Adds the embedding provider settings section. ApiError gains details field. Only verified catalog entries shown. Test-before-save stores signed token for server-side verification."
```
