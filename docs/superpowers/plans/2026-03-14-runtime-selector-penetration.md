# Runtime Selector Penetration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all session/agent create/edit/filter flows runtime-aware, supporting both claude-code and codex runtimes with shared selector components.

**Architecture:** Three shared components (RuntimeSelector, RuntimeAwareModelSelect, RuntimeAwareMachineSelect) composed into 7 integration points. DiscoveredSession type consolidated into shared package. Backend session creation extended with runtime param.

**Tech Stack:** TypeScript, React, Vitest, @testing-library/react, Playwright

**Spec:** `docs/superpowers/specs/2026-03-14-runtime-selector-penetration-design.md`

---

## Chunk 1: Shared Types + Backend

### Task 1: Consolidate DiscoveredSession type into shared package

The `DiscoveredSession` type is defined independently in three places. Consolidate into shared, then have all three locations import from shared.

**Files:**
- Create: `packages/shared/src/types/discovered-session.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/agent-worker/src/runtime/session-discovery.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/control-plane/src/api/routes/sessions.ts`

- [ ] **Step 1: Create the shared type**

Create `packages/shared/src/types/discovered-session.ts`:

```typescript
import type { ManagedRuntime } from './runtime-management.js';

export type DiscoveredSession = {
  sessionId: string;
  projectPath: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  branch: string | null;
  runtime?: ManagedRuntime;
};
```

Note: `machineId` and `hostname` are NOT on the base type — they are added by the CP aggregation layer. The worker discovery returns the base type.

- [ ] **Step 2: Export from shared types index**

Add to `packages/shared/src/types/index.ts`:

```typescript
export type { DiscoveredSession } from './discovered-session.js';
```

- [ ] **Step 3: Update worker to use shared type**

In `packages/agent-worker/src/runtime/session-discovery.ts`, replace the local `DiscoveredSession` type definition (lines 24-37) with:

```typescript
import type { DiscoveredSession } from '@agentctl/shared';
```

Remove the local type definition. Verify all usages still compile.

- [ ] **Step 4: Update web API to use shared type**

In `packages/web/src/lib/api.ts`, replace the local `DiscoveredSession` type (lines 157-166) with:

```typescript
import type { DiscoveredSession as BaseDiscoveredSession } from '@agentctl/shared';

// Web extends base with machine context added by CP aggregation
export type DiscoveredSession = BaseDiscoveredSession & {
  machineId: string;
  hostname: string;
};
```

- [ ] **Step 5: Update CP to use shared type**

In `packages/control-plane/src/api/routes/sessions.ts`, replace `DiscoveredSessionFromWorker` with import from shared:

```typescript
import type { DiscoveredSession as DiscoveredSessionFromWorker } from '@agentctl/shared';
```

- [ ] **Step 6: Verify build**

```bash
pnpm build
```
Expected: 0 errors across all packages

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/discovered-session.ts packages/shared/src/types/index.ts packages/agent-worker/src/runtime/session-discovery.ts packages/web/src/lib/api.ts packages/control-plane/src/api/routes/sessions.ts
git commit -m "refactor: consolidate DiscoveredSession type into shared package"
```

---

### Task 2: Add runtime detection to worker session discovery

**Files:**
- Modify: `packages/agent-worker/src/runtime/session-discovery.ts`
- Test: `packages/agent-worker/src/runtime/session-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Add to existing test file (or create if none exists):

```typescript
import { describe, it, expect } from 'vitest';

describe('session discovery runtime detection', () => {
  it('detects claude-code sessions by .claude directory marker', async () => {
    // Mock filesystem with .claude/ directory in session path
    // Call discoverSessions
    // Expect result[0].runtime === 'claude-code'
  });

  it('detects codex sessions by .codex directory marker', async () => {
    // Mock filesystem with .codex/ directory in session path
    // Expect result[0].runtime === 'codex'
  });

  it('returns undefined runtime when cannot determine', async () => {
    // Mock filesystem with no runtime markers
    // Expect result[0].runtime === undefined
  });
});
```

NOTE: The implementer should follow existing test patterns in `session-discovery.test.ts`. The detection heuristic reads the session's project directory for `.claude/` or `.codex/` markers during the existing filesystem scan.

- [ ] **Step 2: Implement runtime detection**

In `packages/agent-worker/src/runtime/session-discovery.ts`, add runtime detection during the scan:

```typescript
import { access } from 'node:fs/promises';
import { join } from 'node:path';

async function detectSessionRuntime(projectPath: string): Promise<'claude-code' | 'codex' | undefined> {
  try {
    await access(join(projectPath, '.codex'));
    return 'codex';
  } catch {
    // .codex not found, check for .claude
  }
  try {
    await access(join(projectPath, '.claude'));
    return 'claude-code';
  } catch {
    return undefined;
  }
}
```

Call this function during session discovery and populate `runtime` on each `DiscoveredSession`.

- [ ] **Step 3: Run tests**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/session-discovery.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agent-worker/src/runtime/session-discovery.ts packages/agent-worker/src/runtime/session-discovery.test.ts
git commit -m "feat: detect session runtime type during discovery"
```

---

### Task 3: Add `runtime` to session creation API

**Files:**
- Modify: `packages/web/src/lib/api.ts` (~line 660)
- Modify: `packages/control-plane/src/api/routes/sessions.ts` (session creation route)

- [ ] **Step 1: Write failing test for CP session route**

Add to existing CP sessions route tests:

```typescript
describe('POST /api/sessions', () => {
  it('forwards runtime parameter to worker', async () => {
    // Mock worker fetch, verify the body forwarded includes runtime: 'codex'
  });

  it('defaults runtime to undefined when not provided', async () => {
    // Verify backward compat — existing callers without runtime still work
  });
});
```

NOTE: Follow existing CP route test patterns using `app.inject()`.

- [ ] **Step 2: Add `runtime` to CP session creation route**

In `packages/control-plane/src/api/routes/sessions.ts`:
1. Add `runtime?: string` to the Fastify request body schema
2. Extract `runtime` from `request.body` (~line 550)
3. Forward `runtime` in the body sent to the worker (~line 584, add alongside existing fields)

- [ ] **Step 3: Add `runtime` to web API createSession type**

In `packages/web/src/lib/api.ts`, update `createSession` body type (~line 660):

```typescript
createSession: (body: {
  agentId: string;
  machineId: string;
  projectPath: string;
  prompt?: string;
  model?: string;
  resumeSessionId?: string;
  accountId?: string;
  runtime?: string;  // NEW
}) => ...
```

Also add `runtime?: string` to the `updateAgent` body type (~line 536) so Task 9 (GeneralTab) can use it.

- [ ] **Step 4: Run tests**

```bash
cd packages/control-plane && pnpm vitest run src/api/routes/sessions.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/control-plane/src/api/routes/sessions.ts packages/control-plane/src/api/routes/sessions.test.ts
git commit -m "feat: add runtime parameter to session creation API"
```

---

### Task 4: Verify Chunk 1 — full build + tests

- [ ] **Step 1: Run full build**

```bash
pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run all tests**

```bash
pnpm vitest run
```
Expected: all pass

---

## Chunk 2: Shared Components

### Task 5: Create `RuntimeSelector` component

**Files:**
- Create: `packages/web/src/components/RuntimeSelector.tsx`
- Test: `packages/web/src/components/RuntimeSelector.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/RuntimeSelector.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuntimeSelector } from './RuntimeSelector';

describe('RuntimeSelector', () => {
  it('renders both runtime options in radio variant', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} variant="radio" />);

    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('calls onChange when selecting a different runtime', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} variant="radio" />);

    fireEvent.click(screen.getByText('Codex'));
    expect(onChange).toHaveBeenCalledWith('codex');
  });

  it('renders dropdown variant', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="codex" onChange={onChange} variant="dropdown" />);

    // Dropdown should show current value
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('disables all options when disabled prop is true', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} variant="radio" disabled />);

    fireEvent.click(screen.getByText('Codex'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/web && pnpm vitest run src/components/RuntimeSelector.test.tsx
```
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement RuntimeSelector**

Create `packages/web/src/components/RuntimeSelector.tsx`:

```tsx
import { MANAGED_RUNTIMES, type ManagedRuntime } from '@agentctl/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type RuntimeSelectorProps = {
  value: ManagedRuntime;
  onChange: (runtime: ManagedRuntime) => void;
  disabled?: boolean;
  variant?: 'radio' | 'dropdown';
};

const RUNTIME_LABELS: Record<ManagedRuntime, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export function RuntimeSelector({
  value,
  onChange,
  disabled = false,
  variant = 'radio',
}: RuntimeSelectorProps) {
  if (variant === 'dropdown') {
    return (
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ManagedRuntime)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MANAGED_RUNTIMES.map((rt) => (
            <SelectItem key={rt} value={rt}>
              {RUNTIME_LABELS[rt]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Radio variant
  return (
    <div className="flex gap-3" role="radiogroup" aria-label="Runtime">
      {MANAGED_RUNTIMES.map((rt) => (
        <button
          key={rt}
          type="button"
          role="radio"
          aria-checked={value === rt}
          disabled={disabled}
          onClick={() => !disabled && onChange(rt)}
          className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
            value === rt
              ? 'border-blue-500 bg-blue-500/10 text-blue-400'
              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {RUNTIME_LABELS[rt]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/RuntimeSelector.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RuntimeSelector.tsx packages/web/src/components/RuntimeSelector.test.tsx
git commit -m "feat: add RuntimeSelector component (radio + dropdown variants)"
```

---

### Task 6: Create `RuntimeAwareModelSelect` component

**Files:**
- Create: `packages/web/src/components/RuntimeAwareModelSelect.tsx`
- Test: `packages/web/src/components/RuntimeAwareModelSelect.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/RuntimeAwareModelSelect.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RuntimeAwareModelSelect } from './RuntimeAwareModelSelect';

describe('RuntimeAwareModelSelect', () => {
  it('shows Claude models when runtime is claude-code', () => {
    const onChange = vi.fn();
    render(
      <RuntimeAwareModelSelect runtime="claude-code" value="" onChange={onChange} />
    );
    // Should have Claude model options visible
    expect(screen.getByText('Claude Sonnet 4.6')).toBeDefined();
  });

  it('shows Codex models when runtime is codex', () => {
    const onChange = vi.fn();
    render(
      <RuntimeAwareModelSelect runtime="codex" value="" onChange={onChange} />
    );
    expect(screen.getByText('GPT-5 Codex')).toBeDefined();
  });

  it('auto-resets model when runtime changes and current model is invalid', () => {
    const onChange = vi.fn();
    // Start with a Claude model selected, then change runtime to codex
    const { rerender } = render(
      <RuntimeAwareModelSelect runtime="claude-code" value="claude-sonnet-4-6" onChange={onChange} />
    );

    // Rerender with codex runtime — current model is invalid for codex
    rerender(
      <RuntimeAwareModelSelect runtime="codex" value="claude-sonnet-4-6" onChange={onChange} />
    );

    // Should have called onChange with codex default model
    expect(onChange).toHaveBeenCalledWith('gpt-5-codex');
  });

  it('does not reset when current model is valid for new runtime', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RuntimeAwareModelSelect runtime="codex" value="gpt-5-codex" onChange={onChange} />
    );

    rerender(
      <RuntimeAwareModelSelect runtime="codex" value="gpt-5-codex" onChange={onChange} />
    );

    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/web && pnpm vitest run src/components/RuntimeAwareModelSelect.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement RuntimeAwareModelSelect**

Create `packages/web/src/components/RuntimeAwareModelSelect.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { ManagedRuntime } from '@agentctl/shared';
import { RUNTIME_MODEL_OPTIONS, DEFAULT_RUNTIME_MODELS } from '../lib/model-options';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';

const DEFAULT_SENTINEL = '__default__';

type RuntimeAwareModelSelectProps = {
  runtime: ManagedRuntime;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
};

export function RuntimeAwareModelSelect({
  runtime,
  value,
  onChange,
  disabled = false,
}: RuntimeAwareModelSelectProps) {
  const prevRuntimeRef = useRef(runtime);

  useEffect(() => {
    if (prevRuntimeRef.current !== runtime) {
      prevRuntimeRef.current = runtime;

      const models = RUNTIME_MODEL_OPTIONS[runtime];
      const isValid = !value || value === DEFAULT_SENTINEL || models.some((m) => m.value === value);
      if (!isValid) {
        const newDefault = DEFAULT_RUNTIME_MODELS[runtime];
        onChange(newDefault);
        toast.info(`Model reset to ${newDefault}`);
      }
    }
  }, [runtime, value, onChange]);

  const models = RUNTIME_MODEL_OPTIONS[runtime];

  return (
    <Select
      value={value || DEFAULT_SENTINEL}
      onValueChange={(v) => onChange(v === DEFAULT_SENTINEL ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Default" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_SENTINEL}>Default</SelectItem>
        {models.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

NOTE: The spec mentions "free-text input option (combobox pattern) for custom model names." If the existing model selectors in the codebase use a combobox pattern (check `AgentFormDialog` lines 778-822 for the "Custom model ID" input), replicate that pattern here. The above uses a simple Select for clarity — the implementer should match the existing UX pattern.

- [ ] **Step 4: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/RuntimeAwareModelSelect.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RuntimeAwareModelSelect.tsx packages/web/src/components/RuntimeAwareModelSelect.test.tsx
git commit -m "feat: add RuntimeAwareModelSelect with auto-reset on runtime change"
```

---

### Task 7: Create `RuntimeAwareMachineSelect` component

**Files:**
- Create: `packages/web/src/components/RuntimeAwareMachineSelect.tsx`
- Test: `packages/web/src/components/RuntimeAwareMachineSelect.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/RuntimeAwareMachineSelect.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RuntimeAwareMachineSelect } from './RuntimeAwareMachineSelect';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

const mockMachines = [
  { id: 'mac-1', hostname: 'mac-mini', status: 'online' },
  { id: 'ec2-1', hostname: 'ec2-worker', status: 'online' },
] as any;

describe('RuntimeAwareMachineSelect', () => {
  it('renders all machines', () => {
    const onChange = vi.fn();
    render(
      <RuntimeAwareMachineSelect
        runtime="claude-code"
        value="mac-1"
        onChange={onChange}
        machines={mockMachines}
      />,
      { wrapper }
    );

    expect(screen.getByText('mac-mini')).toBeDefined();
    expect(screen.getByText('ec2-worker')).toBeDefined();
  });

  it('disables machines that lack target runtime', () => {
    // This test requires mocking the runtime drift API response
    // Implementer should mock GET /api/runtime-config/drift to return
    // codex as not installed on 'ec2-1'
  });
});
```

NOTE: Full test implementation depends on how the runtime drift API is mocked. The implementer should follow existing query mocking patterns in the web test suite.

- [ ] **Step 2: Implement RuntimeAwareMachineSelect**

Create `packages/web/src/components/RuntimeAwareMachineSelect.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { ManagedRuntime } from '@agentctl/shared';
import type { Machine } from '../lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from 'sonner';

type RuntimeAwareMachineSelectProps = {
  runtime: ManagedRuntime;
  value: string;
  onChange: (machineId: string) => void;
  machines: Machine[];
  disabled?: boolean;
};

export function RuntimeAwareMachineSelect({
  runtime,
  value,
  onChange,
  machines,
  disabled = false,
}: RuntimeAwareMachineSelectProps) {
  // Query runtime drift to know which machines have which runtimes
  // Response shape: { items: Array<{ machineId, runtime, isInstalled, isAuthenticated }> }
  const driftQuery = useQuery({
    queryKey: ['runtime-config', 'drift'],
    queryFn: () => api.getRuntimeConfigDrift(),
    staleTime: 30_000,
  });

  const prevRuntimeRef = useRef(runtime);
  const driftItems = driftQuery.data?.items;

  // Check if a machine supports the target runtime
  // Defined as a stable function using current driftItems
  const checkSupport = (machineId: string, rt: ManagedRuntime): boolean => {
    if (!driftItems) return true; // assume supported while loading
    const entry = driftItems.find(
      (d: any) => d.machineId === machineId && d.runtime === rt
    );
    return entry?.isInstalled ?? true;
  };

  useEffect(() => {
    if (prevRuntimeRef.current !== runtime) {
      prevRuntimeRef.current = runtime;

      if (value && !checkSupport(value, runtime)) {
        const firstAvailable = machines.find((m) => checkSupport(m.id, runtime));
        if (firstAvailable) {
          onChange(firstAvailable.id);
          toast.info(`Machine reset — ${value} does not have ${runtime} installed`);
        }
      }
    }
  }, [runtime, value, machines, onChange, driftItems]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Select machine" />
      </SelectTrigger>
      <SelectContent>
        {machines.map((m) => {
          const supported = checkSupport(m.id, runtime);
          return (
            <SelectItem
              key={m.id}
              value={m.id}
              disabled={!supported}
              className={!supported ? 'opacity-50' : ''}
            >
              {m.hostname}
              {!supported && ` (${runtime} not installed)`}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
```

NOTE: The `api.getRuntimeConfigDrift()` call and response shape should be verified by the implementer. If the endpoint doesn't exist as a single aggregate call, use the existing per-machine drift queries.

- [ ] **Step 3: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/RuntimeAwareMachineSelect.test.tsx
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/RuntimeAwareMachineSelect.tsx packages/web/src/components/RuntimeAwareMachineSelect.test.tsx
git commit -m "feat: add RuntimeAwareMachineSelect with runtime availability filtering"
```

---

## Chunk 3: Form Integration

### Task 8: Integrate runtime selector into AgentFormDialog

**Files:**
- Modify: `packages/web/src/components/AgentFormDialog.tsx`

- [ ] **Step 1: Update types + add runtime state**

First, update `AgentFormCreateData` (~line 75) and `AgentFormEditData` (~line 85) to include `runtime`:

```typescript
type AgentFormCreateData = {
  // ... existing fields
  runtime?: ManagedRuntime;
};

type AgentFormEditData = {
  // ... existing fields
  runtime?: ManagedRuntime;
};
```

Add runtime state after existing state variables (~line 137):

```typescript
const [runtime, setRuntime] = useState<ManagedRuntime>('claude-code');
```

Import `ManagedRuntime`, `isManagedRuntime` from `@agentctl/shared`.

In `populateEditForm` (~line 200), add runtime initialization:

```typescript
setRuntime(a.runtime && isManagedRuntime(a.runtime) ? a.runtime : 'claude-code');
```

In `resetCreateForm` (~line 176), add runtime reset:

```typescript
setRuntime('claude-code');
```

- [ ] **Step 2: Add RuntimeSelector to Advanced section**

Inside the Advanced collapsible section (around line 774), add before the model selector:

```tsx
<div className="space-y-2">
  <Label>Runtime</Label>
  <RuntimeSelector value={runtime} onChange={setRuntime} variant="radio" disabled={isPending} />
</div>
```

For edit mode with unmanaged runtime: show read-only badge instead of selector:

```tsx
{agent?.runtime && !isManagedRuntime(agent.runtime) ? (
  <div className="text-sm text-neutral-500">
    Runtime: {agent.runtime} (unmanaged — not editable)
  </div>
) : (
  <RuntimeSelector ... />
)}
```

- [ ] **Step 3: Replace model selectors with RuntimeAwareModelSelect**

**Create mode**: Replace the model selector in Advanced section (lines 778-822) with:

```tsx
<div className="space-y-2">
  <Label>Model</Label>
  <RuntimeAwareModelSelect runtime={runtime} value={model} onChange={setModel} disabled={isPending} />
</div>
```

**Edit mode**: Also replace the model `<Input>` at lines 886-896 with the same `RuntimeAwareModelSelect` component. Both modes should use the same runtime-aware model selector.

Remove import of `ALL_MODELS` / `MODEL_OPTIONS`.

- [ ] **Step 4: Replace machine selector with RuntimeAwareMachineSelect**

Replace the existing machine selector (~lines 368-399) with:

```tsx
<RuntimeAwareMachineSelect
  runtime={runtime}
  value={machineId}
  onChange={setMachineId}
  machines={machines}
  disabled={isPending}
/>
```

- [ ] **Step 5: Include runtime in form submission**

In `handleSubmit` (~line 234), add `runtime` to the submitted data:

Create mode: add to config or top-level field depending on `AgentFormCreateData` type.
Edit mode: include in mutation payload.

- [ ] **Step 6: Run existing tests**

```bash
cd packages/web && pnpm vitest run src/components/AgentFormDialog.test.tsx
```
Expected: PASS (update tests if they break due to new required fields)

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/AgentFormDialog.tsx
git commit -m "feat: add runtime selector to AgentFormDialog"
```

---

### Task 9: Add runtime to Agent Settings GeneralTab

**Files:**
- Modify: `packages/web/src/components/agent-settings/GeneralTab.tsx`

- [ ] **Step 1: Add runtime state + update isDirty**

Add to existing state variables (~line 41):

```typescript
const [runtime, setRuntime] = useState<ManagedRuntime>(
  agent.runtime && isManagedRuntime(agent.runtime) ? agent.runtime : 'claude-code'
);
```

Update the `isDirty` calculation (~line 46) to include runtime:

```typescript
const isDirty = name !== agent.name
  || machineId !== agent.machineId
  || type !== agent.type
  || runtime !== (agent.runtime ?? 'claude-code')
  || (type === 'cron' && schedule !== (agent.schedule ?? ''));
```

- [ ] **Step 2: Add RuntimeSelector with styled confirmation dialog**

Add after the type selector (~line 130). Use a proper AlertDialog from shadcn/ui (not bare `window.confirm()`), matching the project's dark-first design system:

```tsx
{isManagedRuntime(agent.runtime ?? 'claude-code') && (
  <div className="space-y-2">
    <Label htmlFor="runtime">Runtime</Label>
    <RuntimeSelector
      value={runtime}
      onChange={(newRuntime) => {
        if (newRuntime !== runtime) {
          // Use AlertDialog or toast confirmation
          // On confirm: setRuntime(newRuntime)
          // On cancel: no-op (selector reverts automatically since state unchanged)
        }
      }}
      variant="dropdown"
    />
  </div>
)}
```

NOTE: The implementer should use an existing AlertDialog pattern from the codebase. If none exists, a simple `toast` + undo pattern is acceptable.

- [ ] **Step 3: Include runtime in save handler**

In the save handler (~line 52), build the mutation payload immutably:

```typescript
const runtimeChanged = runtime !== (agent.runtime ?? 'claude-code');

updateAgent.mutate({
  id: agent.id,
  name: name.trim(),
  machineId,
  type,
  runtime,  // NEW — added to updateAgent body type in Task 3
  schedule: type === 'cron' && schedule.trim() ? schedule.trim() : null,
  ...(runtimeChanged ? {
    config: {
      ...agent.config,
      mcpServers: undefined,  // Clear MCP servers on runtime change
    },
  } : {}),
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/agent-settings/GeneralTab.tsx
git commit -m "feat: add runtime selector to agent settings GeneralTab"
```

---

### Task 10: Add runtime to CreateSessionForm

**Files:**
- Modify: `packages/web/src/components/CreateSessionForm.tsx`

- [ ] **Step 1: Add runtime state**

Add after existing state (~line 33):

```typescript
const [runtime, setRuntime] = useState<ManagedRuntime>('claude-code');
```

- [ ] **Step 2: Add RuntimeSelector before model selector**

Add before the model dropdown (~line 185):

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium text-neutral-300">Runtime</label>
  <RuntimeSelector value={runtime} onChange={setRuntime} variant="radio" />
</div>
```

- [ ] **Step 3: Replace model selector with RuntimeAwareModelSelect**

Replace the model `<select>` (~lines 185-196) with:

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium text-neutral-300">Model</label>
  <RuntimeAwareModelSelect runtime={runtime} value={model} onChange={setModel} />
</div>
```

- [ ] **Step 4: Replace machine selector with RuntimeAwareMachineSelect**

Replace machine `<select>` (~lines 127-147) with:

```tsx
<RuntimeAwareMachineSelect
  runtime={runtime}
  value={machineId}
  onChange={setMachineId}
  machines={machines}
/>
```

- [ ] **Step 5: Include runtime in submission + update resetForm**

In `handleSubmit` (~line 70), add `runtime` to `api.createSession()`. Also add `runtime` to the `handleSubmit` useCallback dependency array (~line 113):

```typescript
const result = await api.createSession({
  agentId: 'adhoc',
  machineId,
  projectPath,
  prompt,
  model: model || undefined,
  accountId: accountId || undefined,
  runtime,  // NEW
});
```

In `resetForm` (~line 58), add runtime reset:

```typescript
setRuntime('claude-code');
```

NOTE: `CreateSessionForm` uses native HTML `<select>`/`<input>` elements. The new `RuntimeAwareModelSelect` and `RuntimeAwareMachineSelect` use shadcn `<Select>`. This creates a style inconsistency within the form. The implementer should either convert the remaining native elements to shadcn, or note this as a known visual inconsistency to fix later.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/CreateSessionForm.tsx
git commit -m "feat: add runtime selector to CreateSessionForm"
```

---

### Task 11: Add runtime to DiscoverNewSessionForm + DiscoverPage

**Files:**
- Modify: `packages/web/src/components/DiscoverNewSessionForm.tsx`
- Modify: `packages/web/src/views/DiscoverPage.tsx`

- [ ] **Step 1: Add runtime props to DiscoverNewSessionForm**

Update the props type (~line 11):

```typescript
type DiscoverNewSessionFormProps = {
  // ... existing props
  runtime: ManagedRuntime;        // NEW
  onRuntimeChange: (runtime: ManagedRuntime) => void;  // NEW
};
```

Add RuntimeSelector inside the form, before the submit button:

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium text-neutral-300">Runtime</label>
  <RuntimeSelector value={runtime} onChange={onRuntimeChange} variant="radio" />
</div>
```

- [ ] **Step 2: Add runtime state to DiscoverPage**

In `packages/web/src/views/DiscoverPage.tsx`, add state (~line 93):

```typescript
const [newSessionRuntime, setNewSessionRuntime] = useState<ManagedRuntime>('claude-code');
```

Pass to `DiscoverNewSessionForm`:

```tsx
<DiscoverNewSessionForm
  {...existingProps}
  runtime={newSessionRuntime}
  onRuntimeChange={setNewSessionRuntime}
/>
```

- [ ] **Step 3: Include runtime in handleNewSession**

In `handleNewSession` (~line 325), add `runtime` to `api.createSession()`:

```typescript
const result = await api.createSession({
  agentId: 'adhoc',
  machineId: newMachineId,
  projectPath: newProjectPath,
  prompt: newPrompt,
  runtime: newSessionRuntime,  // NEW
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/DiscoverNewSessionForm.tsx packages/web/src/views/DiscoverPage.tsx
git commit -m "feat: add runtime selector to DiscoverNewSessionForm"
```

---

### Task 12: Verify Chunk 3 — build + tests

- [ ] **Step 1: Run build**

```bash
cd packages/web && pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run all web tests**

```bash
cd packages/web && pnpm vitest run
```
Expected: all pass

---

## Chunk 4: Display Integration + E2E

### Task 13: Add runtime filter + badge to DiscoverPage

**Files:**
- Modify: `packages/web/src/views/DiscoverPage.tsx`

- [ ] **Step 1: Add runtime filter state**

Add to filter state (~line 91):

```typescript
const [runtimeFilter, setRuntimeFilter] = useState<string>('all');
```

- [ ] **Step 2: Add RuntimeSelector dropdown to filter bar**

Add alongside existing filters:

```tsx
<div className="flex items-center gap-2">
  <span className="text-sm text-neutral-400">Runtime:</span>
  <select
    value={runtimeFilter}
    onChange={(e) => setRuntimeFilter(e.target.value)}
    className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
  >
    <option value="all">All</option>
    <option value="claude-code">Claude Code</option>
    <option value="codex">Codex</option>
    <option value="unknown">Unknown</option>
  </select>
</div>
```

- [ ] **Step 3: Filter sessions by runtime**

In the session filtering logic, add runtime filter:

```typescript
const filteredSessions = sessions.filter((s) => {
  // ... existing filters
  if (runtimeFilter !== 'all') {
    if (runtimeFilter === 'unknown') {
      if (s.runtime !== undefined) return false;
    } else {
      if (s.runtime !== runtimeFilter) return false;
    }
  }
  return true;
});
```

- [ ] **Step 4: Add runtime badge to session rows**

In the session row rendering, add a badge:

```tsx
{session.runtime && (
  <span className={`text-xs px-1.5 py-0.5 rounded ${
    session.runtime === 'codex'
      ? 'bg-green-500/10 text-green-400'
      : 'bg-blue-500/10 text-blue-400'
  }`}>
    {session.runtime === 'claude-code' ? 'Claude' : 'Codex'}
  </span>
)}
{!session.runtime && (
  <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400">
    Unknown
  </span>
)}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/DiscoverPage.tsx
git commit -m "feat: add runtime filter and badge to DiscoverPage"
```

---

### Task 14: Add runtime filter to SessionsPage

**Files:**
- Modify: `packages/web/src/views/SessionsPage.tsx`

- [ ] **Step 1: Add runtime display to RuntimeSessionListItem**

In the RuntimeSessionListItem (~line 129), add runtime badge alongside the existing model display:

```tsx
{row.runtime && (
  <span className="text-xs text-neutral-500">
    {row.runtime === 'codex' ? 'Codex' : 'Claude'}
  </span>
)}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/views/SessionsPage.tsx
git commit -m "feat: add runtime badge to SessionsPage session rows"
```

---

### Task 15: Add Available Runtimes to MachineDetailView

**Files:**
- Modify: `packages/web/src/views/MachineDetailView.tsx`

- [ ] **Step 1: Query runtime drift for the machine**

Add a query for runtime config drift:

```typescript
const driftQuery = useQuery({
  queryKey: ['runtime-config', 'drift', machine.id],
  queryFn: () => api.getRuntimeConfigDrift(machine.id),
  staleTime: 30_000,
  enabled: !!machine.id,
});
```

NOTE: Verify the exact API call. The implementer should check what runtime drift endpoint is available and its response format.

- [ ] **Step 2: Add Available Runtimes section**

Add after the Capabilities card (~line 261):

```tsx
<Card>
  <CardHeader>
    <CardTitle>Available Runtimes</CardTitle>
  </CardHeader>
  <CardContent className="space-y-2">
    {driftQuery.isLoading && <span className="text-sm text-neutral-500">Loading...</span>}
    {driftQuery.data?.items?.map((entry: any) => (
      <div key={entry.runtime} className="flex items-center justify-between">
        <span className="text-sm">
          {entry.runtime === 'claude-code' ? 'Claude Code' : 'Codex'}
        </span>
        <div className="flex items-center gap-2">
          {entry.isInstalled ? (
            <span className="text-xs text-green-400">Installed</span>
          ) : (
            <span className="text-xs text-red-400">Not installed</span>
          )}
          {entry.isInstalled && (
            entry.isAuthenticated ? (
              <span className="text-xs text-green-400">Authenticated</span>
            ) : (
              <span className="text-xs text-yellow-400">Not authenticated</span>
            )
          )}
        </div>
      </div>
    ))}
  </CardContent>
</Card>
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/MachineDetailView.tsx
git commit -m "feat: add Available Runtimes section to MachineDetailView"
```

---

### Task 16: Full build + lint verification

- [ ] **Step 1: Run full monorepo build**

```bash
pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```
Expected: 0 errors

- [ ] **Step 3: Run all tests**

```bash
pnpm vitest run
```
Expected: all pass

---

### Task 17: E2E tests

**Files:**
- Create: `packages/web/e2e/runtime-selector.spec.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Runtime Selector', () => {
  test('create agent with codex runtime', async ({ page }) => {
    // Navigate to agents page
    // Click create agent
    // Open Advanced section
    // Select Codex runtime
    // Verify model dropdown shows Codex models
    // Fill required fields
    // Save
    // Verify agent has runtime: 'codex'
  });

  test('create session with codex runtime', async ({ page }) => {
    // Navigate to sessions/create
    // Select Codex runtime
    // Verify model list shows Codex models
    // Fill fields and submit
  });

  test('discover page shows runtime badges', async ({ page }) => {
    // Navigate to discover page
    // Verify runtime badges visible on session rows
    // Select runtime filter
    // Verify filtering works
  });

  test('agent settings runtime change shows confirmation', async ({ page }) => {
    // Navigate to agent settings
    // Change runtime
    // Verify confirmation dialog appears
    // Confirm
    // Verify MCP servers cleared
  });

  test('machine detail shows available runtimes', async ({ page }) => {
    // Navigate to machine detail page
    // Verify "Available Runtimes" section exists
    // Verify installed/authenticated status shown
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
cd packages/web && pnpm exec playwright test e2e/runtime-selector.spec.ts --headed
```
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add packages/web/e2e/runtime-selector.spec.ts
git commit -m "test: add E2E tests for runtime selector integration"
```

---

### Task 18: Final push + PR

- [ ] **Step 1: Final verification**

```bash
pnpm build && pnpm lint && pnpm vitest run
```
Expected: all pass

- [ ] **Step 2: Push branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --title "feat: runtime selector penetration — Codex parity for all flows" --body "$(cat <<'EOF'
## Summary
- Three shared components: RuntimeSelector, RuntimeAwareModelSelect, RuntimeAwareMachineSelect
- Integrated into: AgentFormDialog, GeneralTab, CreateSessionForm, DiscoverNewSessionForm
- DiscoverPage: runtime badges + filter
- SessionsPage: runtime badge in session rows
- MachineDetailView: Available Runtimes section
- DiscoveredSession type consolidated into shared package with runtime detection

## Test plan
- [ ] Unit tests for all 3 shared components
- [ ] Integration: form submissions include runtime
- [ ] E2E: create agent/session with Codex, discover page filter, machine detail
- [ ] Manual: verify on machine with both runtimes installed

## Spec
`docs/superpowers/specs/2026-03-14-runtime-selector-penetration-design.md`
EOF
)"
```

---

## Deferred Items

The following are intentionally out of scope for this plan (Sub-project B: Codex Config Capabilities Exposure):

1. Sandbox level selector
2. Approval policy selector
3. Reasoning effort input
4. Model provider selector (openai/azure)
5. Execution environment selector (direct/docker)
6. Handoff strategy override
7. Config preview
