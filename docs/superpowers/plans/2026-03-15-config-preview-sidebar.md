# Config Preview Sidebar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign agent settings page with a persistent two-column layout — settings tabs on the left, live config preview sidebar on the right showing all rendered config files with Managed/Merged status badges.

**Architecture:** Shared types in `packages/shared`, backend extends existing config-preview endpoint to return per-file responses with status metadata, frontend adds ConfigPreviewPanel + ConfigFileCard components and restructures settings page to two-column grid.

**Tech Stack:** TypeScript, React, Vitest, Fastify, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-15-config-preview-sidebar-design.md`

---

## Chunk 1: Shared Types + Backend

### Task 1: Add shared types for config preview

**Files:**
- Create: `packages/shared/src/types/config-preview.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create types**

Create `packages/shared/src/types/config-preview.ts`:

```typescript
export type ConfigPreviewFileStatus = 'managed' | 'merged';

export type ConfigPreviewFile = {
  path: string;
  scope: 'home' | 'workspace';
  content: string;
  status: ConfigPreviewFileStatus;
  overriddenFields?: string[];
};

export type ConfigPreviewResponse = {
  ok: boolean;
  runtime: string;
  files: ConfigPreviewFile[];
};
```

Export from `packages/shared/src/types/index.ts`.

- [ ] **Step 2: Build shared**

```bash
pnpm --filter @agentctl/shared build
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/config-preview.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add ConfigPreviewFile and ConfigPreviewResponse types"
```

---

### Task 2: Extend worker config-preview endpoint

**Files:**
- Modify: `packages/agent-worker/src/api/routes/config-preview.ts`

- [ ] **Step 1: Add overriddenFields computation**

Add a helper function in the route file:

```typescript
import type { AgentRuntimeConfigOverrides } from '@agentctl/shared';

function computeOverriddenFields(overrides?: AgentRuntimeConfigOverrides): string[] {
  if (!overrides) return [];
  return Object.entries(overrides)
    .filter(([_, v]) => v !== undefined)
    .map(([k]) => k);
}
```

- [ ] **Step 2: Change response to per-file format**

Modify the route handler to:
1. Call the renderer as before to get `RenderedRuntimeConfig` (which has a `files` array of `RenderedConfigFile`)
2. Compute `overriddenFields` from the overrides
3. Map each `RenderedConfigFile` to `ConfigPreviewFile` by adding `status`:
   - If `overriddenFields` is empty → `'managed'` for all files
   - If `overriddenFields` is non-empty → check if the file's content contains any overridden field key → `'merged'` if yes, `'managed'` if no

```typescript
const overridden = computeOverriddenFields(overrides);
const files: ConfigPreviewFile[] = rendered.files.map((f) => {
  const hasOverride = overridden.length > 0 &&
    overridden.some((field) => f.content.includes(field));
  return {
    path: f.path,
    scope: f.scope,
    content: f.content,
    status: hasOverride ? 'merged' : 'managed',
    overriddenFields: hasOverride ? overridden : undefined,
  };
});

return reply.send({ ok: true, runtime, files });
```

- [ ] **Step 3: Build worker**

```bash
pnpm --filter @agentctl/agent-worker build
```

- [ ] **Step 4: Commit**

```bash
git add packages/agent-worker/src/api/routes/config-preview.ts
git commit -m "feat(worker): config-preview returns per-file response with status"
```

---

### Task 3: Update CP proxy to forward new shape

**Files:**
- Modify: `packages/control-plane/src/api/routes/agent-config-preview.ts`

- [ ] **Step 1: Update proxy**

The CP proxy should already forward the worker response transparently. Verify it doesn't destructure or transform the response in a way that breaks the new shape. If it does, update to pass through `files` array.

- [ ] **Step 2: Build CP**

```bash
pnpm --filter @agentctl/control-plane build
```

- [ ] **Step 3: Commit if changed**

```bash
git add packages/control-plane/src/api/routes/agent-config-preview.ts
git commit -m "feat(cp): forward per-file config preview response"
```

---

### Task 4: Update web API types

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Update response type in api.ts**

Change `getAgentConfigPreview` return type to use the new `ConfigPreviewResponse`:

```typescript
import type { ConfigPreviewResponse } from '@agentctl/shared';

getAgentConfigPreview(agentId: string): Promise<ConfigPreviewResponse> {
  return request<ConfigPreviewResponse>(`/api/agents/${agentId}/config-preview`);
},
```

- [ ] **Step 2: Add delayed invalidation in queries.ts**

In the `useUpdateAgent` mutation's `onSuccess`, add preview invalidation with delay:

```typescript
onSuccess: (_, variables) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.agents });
  queryClient.invalidateQueries({ queryKey: queryKeys.agent(variables.id) });
  // Delay preview invalidation to let worker pick up updated config
  setTimeout(() => {
    queryClient.invalidateQueries({
      queryKey: ['agents', variables.id, 'config-preview'],
    });
  }, 500);
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(web): update config preview API type + delayed invalidation"
```

---

### Task 5: Verify backend build

- [ ] **Step 1: Full build**

```bash
pnpm build
```

- [ ] **Step 2: Test on dev-1**

```bash
pm2 restart agentctl-cp-dev1 agentctl-worker-dev1
sleep 3
curl -s http://localhost:8180/api/agents/<agent-id>/config-preview | python3 -m json.tool | head -20
```

Verify response has `files` array with `status` field.

---

## Chunk 2: Frontend Components + Layout

### Task 6: Create ConfigFileCard component

**Files:**
- Create: `packages/web/src/components/agent-settings/ConfigFileCard.tsx`

- [ ] **Step 1: Implement component**

```tsx
'use client';

import type { ConfigPreviewFile } from '@agentctl/shared';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '@/components/CollapsibleSection';

type ConfigFileCardProps = ConfigPreviewFile & {
  defaultOpen?: boolean;
};

const STATUS_STYLES = {
  managed: { label: 'Managed', className: 'bg-green-500/10 text-green-400 border-green-500/30' },
  merged: { label: 'Merged', className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
};

export function ConfigFileCard({
  path,
  content,
  status,
  overriddenFields,
  defaultOpen = false,
}: ConfigFileCardProps) {
  const style = STATUS_STYLES[status];

  const title = (
    <span className="flex items-center gap-2 font-mono text-xs">
      <span>{path}</span>
      <Badge variant="outline" className={style.className}>{style.label}</Badge>
    </span>
  );

  return (
    <CollapsibleSection title={title} defaultOpen={defaultOpen}>
      <pre className="text-xs bg-neutral-900 p-3 rounded-md overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all">
        {status === 'merged' && overriddenFields
          ? renderWithHighlights(content, overriddenFields)
          : content}
      </pre>
    </CollapsibleSection>
  );
}

function renderWithHighlights(content: string, fields: string[]): React.ReactNode {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    const isOverridden = fields.some((f) => line.includes(f));
    return (
      <span
        key={i}
        className={isOverridden ? 'border-l-2 border-blue-500 pl-2 -ml-2 bg-blue-500/5' : ''}
      >
        {line}
        {i < lines.length - 1 ? '\n' : ''}
      </span>
    );
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agent-settings/ConfigFileCard.tsx
git commit -m "feat(web): add ConfigFileCard component with status badges"
```

---

### Task 7: Create ConfigPreviewPanel component

**Files:**
- Create: `packages/web/src/components/agent-settings/ConfigPreviewPanel.tsx`
- Create: `packages/web/src/components/agent-settings/ConfigPreviewPanel.test.tsx`

- [ ] **Step 1: Implement panel**

```tsx
'use client';

import { isManagedRuntime } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ConfigFileCard } from './ConfigFileCard';

type ConfigPreviewPanelProps = {
  agentId: string;
  runtime?: string;
};

export function ConfigPreviewPanel({ agentId, runtime }: ConfigPreviewPanelProps) {
  if (!runtime || !isManagedRuntime(runtime)) {
    return null;
  }

  return <ConfigPreviewPanelInner agentId={agentId} />;
}

function ConfigPreviewPanelInner({ agentId }: { agentId: string }) {
  const previewQuery = useQuery({
    queryKey: ['agents', agentId, 'config-preview'],
    queryFn: () => api.getAgentConfigPreview(agentId),
    staleTime: 10_000,
  });

  if (previewQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-neutral-800/50 rounded-md animate-pulse" />
        ))}
      </div>
    );
  }

  if (previewQuery.error) {
    return (
      <div className="text-sm text-muted-foreground p-4 border border-neutral-800 rounded-md">
        Preview unavailable — worker offline
      </div>
    );
  }

  const files = previewQuery.data?.files ?? [];

  if (files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No config files to preview.</div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Config Preview ({files.length} files)
      </h3>
      {files.map((file, i) => (
        <ConfigFileCard key={file.path} {...file} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write basic test**

Create `ConfigPreviewPanel.test.tsx` with tests for: renders files, loading state, error state, hidden for unmanaged runtime.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agent-settings/ConfigPreviewPanel.tsx packages/web/src/components/agent-settings/ConfigPreviewPanel.test.tsx
git commit -m "feat(web): add ConfigPreviewPanel with skeleton + error states"
```

---

### Task 8: Restructure settings page to two-column layout

**Files:**
- Modify: `packages/web/src/app/agents/[id]/settings/page.tsx`
- Modify: `packages/web/src/components/agent-settings/RuntimeConfigTab.tsx`
- Delete: `packages/web/src/components/agent-settings/ConfigPreview.tsx`

- [ ] **Step 1: Update settings page layout**

In `packages/web/src/app/agents/[id]/settings/page.tsx`:

1. Change all `max-w-[900px]` to `max-w-[1400px]`
2. Wrap the tabs content area in a grid:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
  {/* Left column: existing tabs + content */}
  <div>
    <Tabs ...>
      {/* existing tab triggers + content */}
    </Tabs>
  </div>

  {/* Right column: config preview sidebar */}
  <div className="hidden lg:block sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
    <ConfigPreviewPanel agentId={data.id} runtime={data.runtime} />
  </div>
</div>

{/* Mobile: collapsible at bottom */}
<div className="lg:hidden mt-6">
  <CollapsibleSection title={`Config Preview`} defaultOpen={false}>
    <ConfigPreviewPanel agentId={data.id} runtime={data.runtime} />
  </CollapsibleSection>
</div>
```

- [ ] **Step 2: Remove ConfigPreview from RuntimeConfigTab**

In `RuntimeConfigTab.tsx`, remove the `ConfigPreview` import and its rendering. The preview is now in the sidebar.

- [ ] **Step 3: Delete old ConfigPreview.tsx**

```bash
rm packages/web/src/components/agent-settings/ConfigPreview.tsx
```

- [ ] **Step 4: Run biome + build**

```bash
npx biome check --write packages/web/src/
pnpm --filter @agentctl/web build
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): two-column settings layout with config preview sidebar"
```

---

### Task 9: Verify on dev-1

- [ ] **Step 1: Rebuild and restart dev-1**

```bash
pnpm build
pm2 restart agentctl-cp-dev1 agentctl-worker-dev1 agentctl-web-dev1
```

- [ ] **Step 2: Open browser and verify**

Open `http://localhost:5273/agents/<agent-id>/settings`:
- Left column shows tabs + forms
- Right column shows config preview with file cards
- Each file has Managed or Merged badge
- Changing tabs keeps preview visible
- Save a setting → preview refreshes after ~500ms
- Resize to mobile → preview collapses to bottom

- [ ] **Step 3: Push**

```bash
git push -u origin HEAD
```
