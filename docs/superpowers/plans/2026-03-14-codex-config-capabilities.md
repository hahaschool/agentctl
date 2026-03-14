# Codex Config Capabilities Exposure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose per-agent runtime config overrides (sandbox, approval policy, Codex reasoning/provider) in a new "Runtime Config" settings tab with config preview.

**Architecture:** Extend `AgentConfig` with `runtimeConfigOverrides`, modify config renderers to merge overrides, add config preview endpoint (worker dry-run → CP proxy), and build a simple form tab in the web frontend.

**Tech Stack:** TypeScript, Vitest, React, shadcn/ui, Fastify

**Spec:** `docs/superpowers/specs/2026-03-14-codex-config-capabilities-design.md`

---

## Chunk 1: Shared Types + Backend

### Task 1: Add `AgentRuntimeConfigOverrides` type

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Add the type and extend AgentConfig**

In `packages/shared/src/types/agent.ts`:

```typescript
export type AgentRuntimeConfigOverrides = {
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  codexReasoningEffort?: 'low' | 'medium' | 'high';
  codexModelProvider?: 'openai' | 'azure';
};
```

Add `runtimeConfigOverrides?: AgentRuntimeConfigOverrides` to `AgentConfig`.

Export `AgentRuntimeConfigOverrides` from `packages/shared/src/types/index.ts`.

- [ ] **Step 2: Build shared**

```bash
cd packages/shared && pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add AgentRuntimeConfigOverrides type"
```

---

### Task 2: Merge overrides in config renderers

**Files:**
- Modify: `packages/agent-worker/src/runtime/config/claude-config-renderer.ts`
- Modify: `packages/agent-worker/src/runtime/config/codex-config-renderer.ts`

- [ ] **Step 1: Add override merge to Claude renderer**

In the Claude config renderer, before rendering, merge agent overrides into the managed config:

```typescript
// At the start of render(), after receiving config:
if (agentConfig?.runtimeConfigOverrides) {
  const overrides = agentConfig.runtimeConfigOverrides;
  if (overrides.sandbox) config = { ...config, sandbox: overrides.sandbox };
  if (overrides.approvalPolicy) config = { ...config, approvalPolicy: overrides.approvalPolicy };
}
```

The implementer should find where the renderer receives `ManagedRuntimeConfig` and apply overrides before rendering. The exact insertion point depends on the renderer's function signature.

- [ ] **Step 2: Add override merge to Codex renderer**

Same pattern, plus Codex-specific fields:

```typescript
if (agentConfig?.runtimeConfigOverrides) {
  const overrides = agentConfig.runtimeConfigOverrides;
  if (overrides.sandbox) config = { ...config, sandbox: overrides.sandbox };
  if (overrides.approvalPolicy) config = { ...config, approvalPolicy: overrides.approvalPolicy };
  if (overrides.codexReasoningEffort || overrides.codexModelProvider) {
    config = {
      ...config,
      runtimeOverrides: {
        ...config.runtimeOverrides,
        codex: {
          ...config.runtimeOverrides?.codex,
          ...(overrides.codexReasoningEffort && { reasoningEffort: overrides.codexReasoningEffort }),
          ...(overrides.codexModelProvider && { modelProvider: overrides.codexModelProvider }),
        },
      },
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent-worker/src/runtime/config/
git commit -m "feat(worker): merge per-agent runtime config overrides in renderers"
```

---

### Task 3: Config preview endpoint on worker

**Files:**
- Create: `packages/agent-worker/src/api/routes/config-preview.ts`

- [ ] **Step 1: Create the preview route**

```typescript
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

type ConfigPreviewRouteOptions = FastifyPluginOptions & { logger: Logger };

export async function configPreviewRoutes(
  app: FastifyInstance,
  options: ConfigPreviewRouteOptions,
): Promise<void> {
  const { logger } = options;

  // GET /preview?runtime=claude-code|codex
  // Returns rendered config as string without writing to disk
  app.get<{
    Querystring: { runtime?: string; agentConfigJson?: string };
  }>('/preview', async (request, reply) => {
    const runtime = request.query.runtime ?? 'claude-code';
    const agentConfigJson = request.query.agentConfigJson;

    // Parse agent config if provided
    let agentConfig = {};
    if (agentConfigJson) {
      try { agentConfig = JSON.parse(agentConfigJson); } catch { /* ignore */ }
    }

    // Import and call the appropriate renderer in dry-run mode
    // Return the rendered string
    // Implementation depends on how renderers expose their output

    logger.info({ runtime }, 'Config preview requested');

    return reply.send({ ok: true, runtime, rendered: '(preview)' });
  });
}
```

Register in `server.ts` with `prefix: '/api/config'`.

NOTE: The exact dry-run rendering depends on how `ClaudeConfigRenderer` and `CodexConfigRenderer` expose their rendering logic. The implementer should check if they return strings or write directly to files. If write-only, extract the rendering logic into a pure function that returns a string.

- [ ] **Step 2: Commit**

```bash
git add packages/agent-worker/src/api/routes/config-preview.ts packages/agent-worker/src/api/server.ts
git commit -m "feat(worker): add config preview endpoint"
```

---

### Task 4: Config preview proxy on CP

**Files:**
- Create: `packages/control-plane/src/api/routes/agent-config-preview.ts`

- [ ] **Step 1: Create the proxy route**

Mirror the existing discovery proxy pattern:

```typescript
// GET /api/agents/:id/config-preview
// 1. Look up agent from DB to get machineId + runtime + config
// 2. Resolve worker URL via resolveWorkerUrlByMachineId
// 3. Forward to worker: GET /api/config/preview?runtime=...&agentConfigJson=...
// 4. Return worker response
```

Register in `server.ts`.

- [ ] **Step 2: Commit**

```bash
git add packages/control-plane/src/api/routes/agent-config-preview.ts packages/control-plane/src/api/server.ts
git commit -m "feat(cp): add config preview proxy endpoint"
```

---

### Task 5: Build verification

- [ ] **Step 1: Build all backend packages**

```bash
pnpm --filter @agentctl/shared build && pnpm --filter @agentctl/control-plane build && pnpm --filter @agentctl/agent-worker build
```

- [ ] **Step 2: Commit any fixes**

---

## Chunk 2: Frontend

### Task 6: Add API + query hooks

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add API methods**

```typescript
// api.ts
getAgentConfigPreview(agentId: string): Promise<{ ok: boolean; runtime: string; rendered: string }> {
  return request<...>(`/api/agents/${agentId}/config-preview`);
},

getRuntimeConfigDefaults(): Promise<ManagedRuntimeConfig> {
  return request<...>('/api/runtime-config/defaults');
},
```

- [ ] **Step 2: Add query hooks**

```typescript
// queries.ts
agentConfigPreview: (agentId: string) => ['agents', agentId, 'config-preview'] as const,
runtimeConfigDefaults: ['runtime-config', 'defaults'] as const,
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(web): add config preview and runtime defaults API hooks"
```

---

### Task 7: RuntimeConfigTab component

**Files:**
- Create: `packages/web/src/components/agent-settings/RuntimeConfigTab.tsx`
- Create: `packages/web/src/components/agent-settings/RuntimeConfigTab.test.tsx`

- [ ] **Step 1: Create the tab component**

```tsx
// RuntimeConfigTab.tsx
'use client';

import { isManagedRuntime, type AgentRuntimeConfigOverrides } from '@agentctl/shared';
import type { Agent } from '../../lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useState } from 'react';
// ... useUpdateAgent mutation, toast

const SANDBOX_OPTIONS = [
  { value: '', label: 'Use fleet default' },
  { value: 'read-only', label: 'Read Only' },
  { value: 'workspace-write', label: 'Workspace Write' },
  { value: 'danger-full-access', label: 'Full Access (Danger)' },
];

const APPROVAL_OPTIONS = [
  { value: '', label: 'Use fleet default' },
  { value: 'untrusted', label: 'Untrusted' },
  { value: 'on-failure', label: 'On Failure' },
  { value: 'on-request', label: 'On Request' },
  { value: 'never', label: 'Never' },
];

const REASONING_OPTIONS = [
  { value: '', label: 'Use fleet default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const PROVIDER_OPTIONS = [
  { value: '', label: 'Use fleet default' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure OpenAI' },
];

export function RuntimeConfigTab({ agent }: { agent: Agent }) {
  if (!agent.runtime || !isManagedRuntime(agent.runtime)) {
    return <div className="text-sm text-neutral-500">Runtime config is only available for managed runtimes.</div>;
  }

  const overrides = agent.config?.runtimeConfigOverrides ?? {};
  const [sandbox, setSandbox] = useState(overrides.sandbox ?? '');
  const [approvalPolicy, setApprovalPolicy] = useState(overrides.approvalPolicy ?? '');
  const [reasoningEffort, setReasoningEffort] = useState(overrides.codexReasoningEffort ?? '');
  const [modelProvider, setModelProvider] = useState(overrides.codexModelProvider ?? '');

  const isCodex = agent.runtime === 'codex';

  // Save handler using updateAgent mutation
  // Build runtimeConfigOverrides from non-empty values
  // Toast on success

  return (
    <Card>
      <CardHeader><CardTitle>Runtime Configuration Overrides</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Sandbox Level */}
        <div className="space-y-2">
          <Label>Sandbox Level</Label>
          <Select value={sandbox} onValueChange={setSandbox}>...</Select>
        </div>

        {/* Approval Policy */}
        <div className="space-y-2">
          <Label>Approval Policy</Label>
          <Select value={approvalPolicy} onValueChange={setApprovalPolicy}>...</Select>
        </div>

        {/* Codex-only fields */}
        {isCodex && (
          <>
            <div className="space-y-2">
              <Label>Reasoning Effort</Label>
              <Select value={reasoningEffort} onValueChange={setReasoningEffort}>...</Select>
            </div>
            <div className="space-y-2">
              <Label>Model Provider</Label>
              <Select value={modelProvider} onValueChange={setModelProvider}>...</Select>
            </div>
          </>
        )}

        <Button onClick={handleSave}>Save</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Write basic tests**

```typescript
// RuntimeConfigTab.test.tsx
describe('RuntimeConfigTab', () => {
  it('renders 4 fields for codex runtime', () => {
    // Render with agent.runtime = 'codex'
    // Verify all 4 selects visible
  });

  it('hides codex fields for claude-code runtime', () => {
    // Render with agent.runtime = 'claude-code'
    // Verify only 2 selects (sandbox, approval)
  });

  it('shows message for unmanaged runtime', () => {
    // Render with agent.runtime = 'nanoclaw'
    // Verify message shown
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agent-settings/RuntimeConfigTab.tsx packages/web/src/components/agent-settings/RuntimeConfigTab.test.tsx
git commit -m "feat(web): add RuntimeConfigTab component"
```

---

### Task 8: ConfigPreview component

**Files:**
- Create: `packages/web/src/components/agent-settings/ConfigPreview.tsx`

- [ ] **Step 1: Create the preview component**

Collapsible section that fetches and displays rendered config:

```tsx
// ConfigPreview.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { CollapsibleSection } from '../CollapsibleSection';

export function ConfigPreview({ agentId, runtime }: { agentId: string; runtime: string }) {
  const previewQuery = useQuery({
    queryKey: ['agents', agentId, 'config-preview'],
    queryFn: () => api.getAgentConfigPreview(agentId),
    staleTime: 10_000,
  });

  return (
    <CollapsibleSection title="Config Preview" defaultOpen={false}>
      {previewQuery.isLoading && <span className="text-sm text-neutral-500">Loading...</span>}
      {previewQuery.error && <span className="text-sm text-red-400">Failed to load preview</span>}
      {previewQuery.data && (
        <pre className="text-xs bg-neutral-900 p-3 rounded-md overflow-x-auto font-mono">
          {previewQuery.data.rendered}
        </pre>
      )}
    </CollapsibleSection>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agent-settings/ConfigPreview.tsx
git commit -m "feat(web): add ConfigPreview component"
```

---

### Task 9: Register tab in agent settings

**Files:**
- Modify: `packages/web/src/app/agents/[id]/settings/page.tsx`

- [ ] **Step 1: Add "Runtime Config" tab**

```typescript
// Add to TABS array (after 'memory')
{ value: 'runtime-config', label: 'Runtime Config' },

// Add import
import { RuntimeConfigTab } from '@/components/agent-settings/RuntimeConfigTab';
import { ConfigPreview } from '@/components/agent-settings/ConfigPreview';

// Add TabsContent
<TabsContent value="runtime-config">
  <div className="space-y-6">
    <RuntimeConfigTab agent={data} />
    {data.runtime && isManagedRuntime(data.runtime) && (
      <ConfigPreview agentId={data.id} runtime={data.runtime} />
    )}
  </div>
</TabsContent>
```

- [ ] **Step 2: Build + lint**

```bash
cd packages/web && pnpm build && npx biome check --write src/
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/agents/\[id\]/settings/page.tsx
git commit -m "feat(web): register Runtime Config tab in agent settings"
```

---

### Task 10: Final verification + push

- [ ] **Step 1: Full build**

```bash
pnpm build
```

- [ ] **Step 2: Push**

```bash
git push -u origin HEAD
```
