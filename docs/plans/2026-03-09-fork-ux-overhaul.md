# Fork & Agent Creation UX Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> ℹ️ **Note:** Runtime names updated 2026-03-10 — `nanoclaw`/`openclaw` replaced with `codex` to match canonical `ManagedRuntime` type.

**Goal:** Unify the fork/create-agent flows into a single dialog with smart context selection, agent runtime as an orthogonal dimension, and claude-mem memory-powered auto-select for navigating 2k+ message histories.

**Architecture:** Replace the current dual-mode ContextPickerDialog (fork vs create-agent) with a single unified dialog featuring a tab toggle (Quick Fork / Create as Agent). Add an `AgentRuntime` dimension orthogonal to `AgentType` trigger types. Integrate claude-mem's 9k+ observation library as a first-class context source — search memories, display matches, auto-highlight corresponding raw messages. Add smart selection tools (key decisions, by-topic, timeline markers) and a live prompt preview panel.

**Tech Stack:** React 19, @tanstack/react-virtual, @tanstack/react-query, Tailwind CSS, Radix UI primitives, better-sqlite3 (claude-mem queries via CP), Vitest + React Testing Library.

---

## Phase 1: Type System & Bug Fixes (Foundation)

### Task 1: Add AgentRuntime to shared types

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Test: `packages/shared/src/types/agent.test.ts` (create if needed)

**Step 1: Add AgentRuntime type and update Agent shape**

```typescript
// In packages/shared/src/types/agent.ts, ADD:

export type AgentRuntime = 'claude-code' | 'codex';

// UPDATE Agent type — add runtime field:
export type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: AgentType;
  runtime: AgentRuntime;  // NEW
  status: AgentStatus;
  // ... rest unchanged
};
```

**Step 2: Add AGENT_RUNTIMES constant to shared**

```typescript
// In packages/shared/src/types/agent.ts, ADD:

export const AGENT_RUNTIMES: readonly { value: AgentRuntime; label: string; desc: string }[] = [
  { value: 'claude-code', label: 'Claude Code', desc: 'Full Claude Code CLI with built-in tools' },
  { value: 'codex', label: 'Codex', desc: 'Lightweight agent with filesystem IPC' },
] as const;
```

**Step 3: Export from shared barrel**

Ensure `AgentRuntime` and `AGENT_RUNTIMES` are exported from `packages/shared/src/index.ts`.

**Step 4: Run type check**

Run: `cd packages/shared && pnpm tsc --noEmit`
Expected: Type errors in files referencing `Agent` type (missing `runtime` field) — we'll fix those in subsequent tasks.

**Step 5: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/index.ts
git commit -m "feat(shared): add AgentRuntime type orthogonal to AgentType trigger"
```

---

### Task 2: Add runtime column to DB + control-plane agent routes

**Files:**
- Modify: `packages/control-plane/src/api/routes/agents.ts`
- Modify: `packages/control-plane/src/db/registry.ts` (or wherever agent CRUD lives)
- Test: existing agent route tests

**Step 1: Add DB migration for runtime column**

Add `runtime TEXT NOT NULL DEFAULT 'claude-code'` to the agents table. This is a non-breaking migration — existing agents default to claude-code.

**Step 2: Update create-agent route to accept runtime**

```typescript
// In POST /api/agents handler, add runtime to the request body:
const { machineId, name, type, runtime, schedule, projectPath, config } = request.body;

// Validate runtime is one of the allowed values:
const VALID_RUNTIMES = ['claude-code', 'codex'];
if (runtime && !VALID_RUNTIMES.includes(runtime)) {
  return reply.status(400).send({ error: `Invalid runtime: ${runtime}. Must be one of: ${VALID_RUNTIMES.join(', ')}` });
}
```

**Step 3: Update create-agent route to validate type enum**

```typescript
const VALID_TYPES: AgentType[] = ['adhoc', 'manual', 'loop', 'heartbeat', 'cron'];
if (!VALID_TYPES.includes(type as AgentType)) {
  return reply.status(400).send({ error: `Invalid agent type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}` });
}
```

**Step 4: Write failing test for runtime validation**

```typescript
it('rejects invalid runtime value', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agents',
    payload: { name: 'test', machineId: 'm1', type: 'adhoc', runtime: 'invalid' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toContain('Invalid runtime');
});

it('accepts valid runtime value', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agents',
    payload: { name: 'test', machineId: 'm1', type: 'adhoc', runtime: 'codex' },
  });
  expect(res.statusCode).toBe(200);
});
```

**Step 5: Run tests**

Run: `cd packages/control-plane && pnpm test -- --grep "agents"`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/control-plane/
git commit -m "feat(cp): add runtime column to agents + type/runtime validation"
```

---

### Task 3: Fix ConvertToAgentForm type bugs

**Files:**
- Modify: `packages/web/src/components/ConvertToAgentForm.tsx`
- Modify: `packages/web/src/components/ConvertToAgentForm.test.tsx`

**Step 1: Update test expectations first (TDD)**

In the test file, update all instances of:
- `'autonomous'` → `'adhoc'` (for default type)
- `'ad-hoc'` → `'adhoc'` (for option values)
- Remove "Autonomous (long-running)" label expectations
- Use `FORK_AGENT_TYPES` imported from model-options

**Step 2: Run tests to verify they fail**

Run: `cd packages/web && pnpm test -- ConvertToAgentForm`
Expected: FAIL — component still renders old values

**Step 3: Update ConvertToAgentForm to use FORK_AGENT_TYPES**

```typescript
// Replace hardcoded <option> elements with:
import { FORK_AGENT_TYPES } from '@/lib/model-options';

// In the select:
{FORK_AGENT_TYPES.map((t) => (
  <option key={t.value} value={t.value}>
    {t.label} — {t.desc}
  </option>
))}
```

Also update the default value in SessionsPage.tsx: `const [convertType, setConvertType] = useState('adhoc');` (was `'autonomous'`).

**Step 4: Run tests to verify they pass**

Run: `cd packages/web && pnpm test -- ConvertToAgentForm`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/components/ConvertToAgentForm.tsx packages/web/src/components/ConvertToAgentForm.test.tsx packages/web/src/views/SessionsPage.tsx
git commit -m "fix(web): ConvertToAgentForm uses canonical agent types from FORK_AGENT_TYPES"
```

---

### Task 4: Add runtime selector to model-options.ts

**Files:**
- Modify: `packages/web/src/lib/model-options.ts`

**Step 1: Re-export AGENT_RUNTIMES for web consumption**

```typescript
// In packages/web/src/lib/model-options.ts, ADD:
import { AGENT_RUNTIMES } from '@agentctl/shared';

export { AGENT_RUNTIMES };

// Also export a convenience type:
export type RuntimeOption = (typeof AGENT_RUNTIMES)[number];
```

**Step 2: Run type check**

Run: `cd packages/web && pnpm tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/web/src/lib/model-options.ts
git commit -m "feat(web): re-export AGENT_RUNTIMES from model-options"
```

---

## Phase 2: Unified Fork Dialog Redesign

### Task 5: Refactor ContextPickerDialog types for unified mode

**Files:**
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx` (lines 17-43)
- Modify: `packages/web/src/components/context-picker/index.ts`

**Step 1: Update test for new unified submit type**

In `ContextPickerDialog.test.tsx`, add tests for the unified mode:

```typescript
describe('unified mode', () => {
  it('renders tab toggle between Quick Fork and Create as Agent', () => {
    render(<ContextPickerDialog mode="fork" {...baseProps} />);
    expect(screen.getByRole('tab', { name: /quick fork/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /create as agent/i })).toBeInTheDocument();
  });

  it('defaults to Quick Fork tab', () => {
    render(<ContextPickerDialog mode="fork" {...baseProps} />);
    expect(screen.getByRole('tab', { name: /quick fork/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Create as Agent tab', async () => {
    render(<ContextPickerDialog mode="fork" {...baseProps} />);
    await userEvent.click(screen.getByRole('tab', { name: /create as agent/i }));
    expect(screen.getByLabelText(/agent name/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/web && pnpm test -- ContextPickerDialog`
Expected: FAIL — no tab elements exist yet

**Step 3: Replace mode prop with unified tab toggle**

Remove the `mode` prop. The dialog always shows both tabs. Replace the right panel with a tab-based UI:

```typescript
export type ContextPickerDialogProps = {
  session: Session;
  messages: SessionContentMessage[];
  open: boolean;
  onClose: () => void;
  onForkSubmit: (config: ForkSubmitConfig) => void;
  onCreateAgentSubmit?: (config: CreateAgentSubmitConfig) => void;
  isSubmitting?: boolean;
  defaultTab?: 'fork' | 'agent';  // NEW: which tab to show first
};
```

Inside the component, add tab state:

```typescript
const [activeTab, setActiveTab] = useState<'fork' | 'agent'>(props.defaultTab ?? 'fork');
```

Render tab bar at top of right panel:

```tsx
<div role="tablist" className="flex border-b border-border">
  <button
    role="tab"
    aria-selected={activeTab === 'fork'}
    onClick={() => setActiveTab('fork')}
    className={cn(
      'flex-1 px-3 py-2 text-xs font-medium transition-colors',
      activeTab === 'fork'
        ? 'text-foreground border-b-2 border-primary'
        : 'text-muted-foreground hover:text-foreground',
    )}
  >
    Quick Fork
  </button>
  <button
    role="tab"
    aria-selected={activeTab === 'agent'}
    onClick={() => setActiveTab('agent')}
    className={cn(
      'flex-1 px-3 py-2 text-xs font-medium transition-colors',
      activeTab === 'agent'
        ? 'text-foreground border-b-2 border-primary'
        : 'text-muted-foreground hover:text-foreground',
    )}
  >
    Create as Agent
  </button>
</div>
```

Then conditionally render `ForkConfigPanel` (tab=fork) or the create-agent form (tab=agent) below.

**Step 4: Run tests**

Run: `cd packages/web && pnpm test -- ContextPickerDialog`
Expected: PASS (update any broken tests from mode removal)

**Step 5: Commit**

```bash
git add packages/web/src/components/context-picker/
git commit -m "feat(web): unified fork dialog with Quick Fork / Create as Agent tabs"
```

---

### Task 6: Add runtime selector to Create as Agent tab

**Files:**
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx` (create-agent panel, ~lines 411-509)

**Step 1: Write failing test**

```typescript
it('renders runtime selector in Create as Agent tab', async () => {
  render(<ContextPickerDialog defaultTab="agent" {...baseProps} />);
  expect(screen.getByLabelText(/agent runtime/i)).toBeInTheDocument();
  expect(screen.getByText(/claude code/i)).toBeInTheDocument();
  expect(screen.getByText(/codex/i)).toBeInTheDocument();
});

it('includes runtime in create-agent submit config', async () => {
  const onSubmit = vi.fn();
  render(<ContextPickerDialog defaultTab="agent" onCreateAgentSubmit={onSubmit} {...baseProps} />);
  // Fill required fields
  await userEvent.type(screen.getByLabelText(/agent name/i), 'test-agent');
  // Select codex runtime
  await userEvent.selectOptions(screen.getByLabelText(/agent runtime/i), 'codex');
  await userEvent.click(screen.getByRole('button', { name: /create agent/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ runtime: 'codex' }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/web && pnpm test -- ContextPickerDialog`
Expected: FAIL — no runtime selector

**Step 3: Add runtime state and selector**

```typescript
// State:
const [agentRuntime, setAgentRuntime] = useState<AgentRuntime>('claude-code');

// In CreateAgentSubmitConfig type, ADD:
export type CreateAgentSubmitConfig = {
  name: string;
  type: string;
  runtime: AgentRuntime;  // NEW
  model?: string;
  systemPrompt?: string;
  selectedMessageIds: number[];
};

// In the create-agent panel, ADD selector after type:
<label htmlFor="agent-runtime" className="text-xs text-muted-foreground">
  Runtime
</label>
<select
  id="agent-runtime"
  aria-label="Agent runtime"
  value={agentRuntime}
  onChange={(e) => setAgentRuntime(e.target.value as AgentRuntime)}
  className="..."
>
  {AGENT_RUNTIMES.map((r) => (
    <option key={r.value} value={r.value}>
      {r.label} — {r.desc}
    </option>
  ))}
</select>
```

**Step 4: Run tests**

Run: `cd packages/web && pnpm test -- ContextPickerDialog`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/components/context-picker/
git commit -m "feat(web): add runtime selector to Create as Agent tab"
```

---

### Task 7: Update SessionHeader to use unified dialog

**Files:**
- Modify: `packages/web/src/components/SessionHeader.tsx` (lines 231-293, 457-469)
- Modify: `packages/web/src/components/SessionHeader.test.tsx`

**Step 1: Update SessionHeader to pass both callbacks**

The SessionHeader currently only passes `onForkSubmit` to ContextPickerDialog. Update it to also pass `onCreateAgentSubmit` and remove the `mode="fork"` prop:

```typescript
<ContextPickerDialog
  session={session}
  messages={contextPickerMessages}
  open={showContextPicker}
  onClose={() => { setShowContextPicker(false); setContextPickerMessages([]); }}
  onForkSubmit={handleForkSubmit}
  onCreateAgentSubmit={handleCreateAgentSubmit}  // NEW
  isSubmitting={forkSession.isPending || createAgent.isPending}
/>
```

Add `handleCreateAgentSubmit` callback (similar to SessionsPage's version) that creates an agent from the current session.

**Step 2: Update tests**

Update SessionHeader tests to verify the unified dialog works for both fork and create-agent from the session detail view.

**Step 3: Run tests**

Run: `cd packages/web && pnpm test -- SessionHeader`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/web/src/components/SessionHeader.tsx packages/web/src/components/SessionHeader.test.tsx
git commit -m "feat(web): SessionHeader uses unified fork dialog with create-agent support"
```

---

### Task 8: Update SessionsPage to use unified dialog

**Files:**
- Modify: `packages/web/src/views/SessionsPage.tsx` (lines 129-138, 434-494, 971-985)

**Step 1: Update SessionsPage**

- Remove `mode="create-agent"` from ContextPickerDialog
- Pass `defaultTab="agent"` instead (to open on Create as Agent tab by default)
- Rename `handleForkSubmit` → `handleCreateAgentSubmit` (fixes the naming confusion bug)
- Add a `handleForkSubmit` callback for fork-from-sessions-page use case
- Pass both callbacks to the unified dialog

```typescript
<ContextPickerDialog
  session={selected}
  messages={forkPickerMessages}
  open={showForkPicker}
  onClose={() => { setShowForkPicker(false); setForkPickerMessages([]); }}
  onForkSubmit={handleForkFromSession}
  onCreateAgentSubmit={handleCreateAgentSubmit}
  defaultTab="agent"
  isSubmitting={createAgent.isPending || forkSession.isPending}
/>
```

**Step 2: Run tests**

Run: `cd packages/web && pnpm test -- SessionsPage`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/web/src/views/SessionsPage.tsx
git commit -m "feat(web): SessionsPage uses unified fork dialog, fix callback naming"
```

---

### Task 9: Remove dead ConvertToAgentForm (if now redundant)

**Files:**
- Delete: `packages/web/src/components/ConvertToAgentForm.tsx`
- Delete: `packages/web/src/components/ConvertToAgentForm.test.tsx`
- Modify: any files that import ConvertToAgentForm

**Step 1: Search for all imports of ConvertToAgentForm**

Run: `grep -r "ConvertToAgentForm" packages/web/src/`

If the only consumers are SessionsPage and SessionDetailPanel, and those are now using the unified dialog, this component is dead code.

**Step 2: Remove the files and update imports**

**Step 3: Run full web test suite**

Run: `cd packages/web && pnpm test`
Expected: PASS (no references to deleted component)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(web): remove dead ConvertToAgentForm replaced by unified dialog"
```

---

## Phase 3: Smart Context Selection Tools

### Task 10: Add Timeline Markers to the virtualized message list

**Files:**
- Create: `packages/web/src/components/context-picker/TimelineMarkers.tsx`
- Create: `packages/web/src/components/context-picker/TimelineMarkers.test.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx`

Timeline markers are visual dividers inserted into the message list at key points — time gaps, topic shifts, and human turn boundaries. They serve as scroll navigation anchors.

**Step 1: Write failing test for TimelineMarkers**

```typescript
// TimelineMarkers.test.tsx
import { computeTimelineMarkers } from './TimelineMarkers';

describe('computeTimelineMarkers', () => {
  it('inserts time-gap marker when >30 min between messages', () => {
    const messages = [
      { type: 'human', content: 'msg1', timestamp: '2026-03-09T10:00:00Z' },
      { type: 'assistant', content: 'msg2', timestamp: '2026-03-09T10:01:00Z' },
      { type: 'human', content: 'msg3', timestamp: '2026-03-09T11:00:00Z' },  // 59 min gap
    ];
    const markers = computeTimelineMarkers(messages);
    expect(markers).toContainEqual(
      expect.objectContaining({ afterIndex: 1, type: 'time-gap', label: expect.stringContaining('59m') }),
    );
  });

  it('inserts human-turn marker at each new human message', () => {
    const messages = [
      { type: 'human', content: 'first request' },
      { type: 'assistant', content: 'response' },
      { type: 'tool_use', content: '...' },
      { type: 'tool_result', content: '...' },
      { type: 'human', content: 'second request' },
    ];
    const markers = computeTimelineMarkers(messages);
    expect(markers).toContainEqual(
      expect.objectContaining({ afterIndex: 3, type: 'human-turn', label: 'Turn 2' }),
    );
  });

  it('returns empty array for empty messages', () => {
    expect(computeTimelineMarkers([])).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/web && pnpm test -- TimelineMarkers`
Expected: FAIL — module not found

**Step 3: Implement computeTimelineMarkers + TimelineMarkerRow component**

```typescript
// TimelineMarkers.tsx
import type { SessionContentMessage } from '@agentctl/shared';

export type TimelineMarker = {
  afterIndex: number;  // marker appears after this message index
  type: 'time-gap' | 'human-turn';
  label: string;
};

const TIME_GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function computeTimelineMarkers(messages: SessionContentMessage[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  let turnCount = 1;

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    // Time gap detection
    if (prev?.timestamp && curr?.timestamp) {
      const gap = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
      if (gap >= TIME_GAP_THRESHOLD_MS) {
        const mins = Math.round(gap / 60_000);
        const label = mins >= 60 ? `${Math.round(mins / 60)}h gap` : `${mins}m gap`;
        markers.push({ afterIndex: i - 1, type: 'time-gap', label });
      }
    }

    // Human turn boundary
    if (curr?.type === 'human' && prev?.type !== 'human') {
      turnCount++;
      markers.push({ afterIndex: i - 1, type: 'human-turn', label: `Turn ${turnCount}` });
    }
  }

  return markers;
}

// React component for rendering a marker row in the virtualizer
export const TimelineMarkerRow = React.memo(function TimelineMarkerRow({
  marker,
  onClick,
}: {
  marker: TimelineMarker;
  onClick: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-4 py-1 text-[10px] cursor-pointer transition-colors',
        marker.type === 'time-gap'
          ? 'text-yellow-600 bg-yellow-500/5 hover:bg-yellow-500/10'
          : 'text-blue-600 bg-blue-500/5 hover:bg-blue-500/10',
      )}
    >
      <span className="flex-1 border-t border-current opacity-30" />
      <span className="font-medium whitespace-nowrap">{marker.label}</span>
      <span className="flex-1 border-t border-current opacity-30" />
    </button>
  );
});
```

**Step 4: Integrate markers into the virtualized list**

In ContextPickerDialog, compute markers and interleave them with messages in the virtualizer. Each marker gets a shorter row height (28px vs 56px for messages).

**Step 5: Run tests**

Run: `cd packages/web && pnpm test -- TimelineMarkers && pnpm test -- ContextPickerDialog`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/web/src/components/context-picker/TimelineMarkers.tsx packages/web/src/components/context-picker/TimelineMarkers.test.tsx packages/web/src/components/context-picker/ContextPickerDialog.tsx
git commit -m "feat(web): timeline markers in context picker — time gaps + human turn boundaries"
```

---

### Task 11: Add "Key Decisions" auto-select tool

**Files:**
- Create: `packages/web/src/components/context-picker/SmartSelectTools.tsx`
- Create: `packages/web/src/components/context-picker/SmartSelectTools.test.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerToolbar.tsx`

"Key Decisions" scans messages for decision patterns: messages containing "decided", "decision", "chose", "going with", "let's go with", strategy keywords, architectural terms. It auto-selects matching messages + surrounding context (1 message before/after each match).

**Step 1: Write failing test**

```typescript
// SmartSelectTools.test.tsx
import { findKeyDecisionIndices } from './SmartSelectTools';

describe('findKeyDecisionIndices', () => {
  const messages = [
    { type: 'human', content: 'Can you help me?' },
    { type: 'assistant', content: 'Sure, I can help.' },
    { type: 'human', content: 'I decided to use PostgreSQL instead of SQLite.' },
    { type: 'assistant', content: 'Good choice. PostgreSQL is better for concurrent access.' },
    { type: 'human', content: 'What about the API framework?' },
    { type: 'assistant', content: "Let's go with Fastify for the API layer." },
    { type: 'tool_use', content: 'Reading package.json...' },
    { type: 'tool_result', content: '{ "dependencies": {} }' },
    { type: 'assistant', content: 'I updated the dependencies.' },
  ];

  it('finds messages with decision keywords', () => {
    const indices = findKeyDecisionIndices(messages);
    expect(indices).toContain(2);  // "decided to use PostgreSQL"
    expect(indices).toContain(5);  // "Let's go with Fastify"
  });

  it('includes surrounding context (1 before + 1 after)', () => {
    const indices = findKeyDecisionIndices(messages);
    expect(indices).toContain(1);  // context before "decided"
    expect(indices).toContain(3);  // context after "decided"
    expect(indices).toContain(4);  // context before "let's go with"
  });

  it('does not include tool_use or tool_result by default', () => {
    const indices = findKeyDecisionIndices(messages);
    expect(indices).not.toContain(6);
    expect(indices).not.toContain(7);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/web && pnpm test -- SmartSelectTools`
Expected: FAIL — module not found

**Step 3: Implement findKeyDecisionIndices**

```typescript
// SmartSelectTools.tsx

const DECISION_PATTERNS = [
  /\bdecid(?:ed|e|ing)\b/i,
  /\bdecision\b/i,
  /\bcho(?:se|ice|ose|osing)\b/i,
  /\bgoing with\b/i,
  /\blet'?s go with\b/i,
  /\bwe(?:'ll| will) use\b/i,
  /\binstead of\b/i,
  /\bapproach[:\s]/i,
  /\bstrategy[:\s]/i,
  /\btrade-?off/i,
  /\barchitect(?:ure|ural)/i,
];

export function findKeyDecisionIndices(
  messages: { type: string; content: string }[],
  contextRadius = 1,
): number[] {
  const matchIndices = new Set<number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'progress') {
      continue;
    }
    if (DECISION_PATTERNS.some((pat) => pat.test(msg.content))) {
      // Add match + context window
      for (let j = Math.max(0, i - contextRadius); j <= Math.min(messages.length - 1, i + contextRadius); j++) {
        const ctx = messages[j];
        if (ctx && ctx.type !== 'tool_use' && ctx.type !== 'tool_result' && ctx.type !== 'progress') {
          matchIndices.add(j);
        }
      }
    }
  }

  return Array.from(matchIndices).sort((a, b) => a - b);
}
```

**Step 4: Add "Key Decisions" button to ContextPickerToolbar**

Add a new row of smart select buttons below the existing bulk action buttons:

```tsx
{/* Row 3: Smart select tools */}
<div className="flex items-center gap-1.5">
  <span className="text-[10px] text-muted-foreground mr-1">Smart:</span>
  <button
    type="button"
    onClick={onSelectKeyDecisions}
    aria-label="Auto-select key decisions"
    className="px-2 py-0.5 text-[10px] text-purple-600 dark:text-purple-400 border border-purple-300/50 dark:border-purple-800/50 rounded-md hover:bg-purple-100/50 dark:hover:bg-purple-900/30 cursor-pointer transition-colors"
  >
    Key Decisions
  </button>
</div>
```

Wire `onSelectKeyDecisions` through to the dialog, which calls `findKeyDecisionIndices(messages)` and sets those as selected.

**Step 5: Run tests**

Run: `cd packages/web && pnpm test -- SmartSelectTools && pnpm test -- ContextPickerToolbar`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/web/src/components/context-picker/SmartSelectTools.tsx packages/web/src/components/context-picker/SmartSelectTools.test.tsx packages/web/src/components/context-picker/ContextPickerToolbar.tsx packages/web/src/components/context-picker/ContextPickerDialog.tsx
git commit -m "feat(web): 'Key Decisions' smart auto-select tool for context picker"
```

---

### Task 12: Add "By Topic" search-based select tool

**Files:**
- Modify: `packages/web/src/components/context-picker/SmartSelectTools.tsx`
- Modify: `packages/web/src/components/context-picker/SmartSelectTools.test.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerToolbar.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx`

"By Topic" lets the user type a topic (e.g., "authentication", "database migration") and uses fuzzyScore to find and select all messages that match. Reuses the existing `fuzzyScore` from `lib/fuzzy-search.ts`.

**Step 1: Write failing test**

```typescript
// In SmartSelectTools.test.tsx, ADD:
import { findByTopicIndices } from './SmartSelectTools';

describe('findByTopicIndices', () => {
  const messages = [
    { type: 'human', content: 'Let me set up the authentication system' },
    { type: 'assistant', content: 'I will create the auth middleware using JWT tokens' },
    { type: 'human', content: 'Now let us work on the database schema' },
    { type: 'assistant', content: 'Here is the PostgreSQL migration for users table' },
    { type: 'human', content: 'Can you add password hashing to the auth flow?' },
    { type: 'assistant', content: 'Added bcrypt hashing to the authentication handler' },
  ];

  it('finds messages matching the topic', () => {
    const indices = findByTopicIndices(messages, 'authentication');
    expect(indices).toContain(0);  // "authentication system"
    expect(indices).toContain(1);  // "auth middleware"
    expect(indices).toContain(4);  // "auth flow"
    expect(indices).toContain(5);  // "authentication handler"
  });

  it('does not include unrelated messages', () => {
    const indices = findByTopicIndices(messages, 'authentication');
    expect(indices).not.toContain(2);  // database schema
    expect(indices).not.toContain(3);  // PostgreSQL migration
  });

  it('returns empty for no matches', () => {
    expect(findByTopicIndices(messages, 'kubernetes')).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/web && pnpm test -- SmartSelectTools`
Expected: FAIL — findByTopicIndices not found

**Step 3: Implement findByTopicIndices**

```typescript
import { fuzzyScore } from '@/lib/fuzzy-search';

const TOPIC_SCORE_THRESHOLD = 10; // minimum fuzzyScore to count as a match

export function findByTopicIndices(
  messages: { type: string; content: string }[],
  topic: string,
  contextRadius = 1,
): number[] {
  if (!topic.trim()) return [];

  const matchIndices = new Set<number>();
  const keywords = topic.toLowerCase().split(/\s+/).filter(Boolean);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    // Check if any keyword fuzzy-matches any word in the message
    const words = msg.content.toLowerCase().split(/\s+/);
    const isMatch = keywords.some((kw) =>
      words.some((w) => {
        const score = fuzzyScore(kw, w);
        return score !== null && score >= TOPIC_SCORE_THRESHOLD;
      }) || fuzzyScore(kw, msg.content) !== null && (fuzzyScore(kw, msg.content) ?? 0) >= TOPIC_SCORE_THRESHOLD
    );

    if (isMatch) {
      for (let j = Math.max(0, i - contextRadius); j <= Math.min(messages.length - 1, i + contextRadius); j++) {
        matchIndices.add(j);
      }
    }
  }

  return Array.from(matchIndices).sort((a, b) => a - b);
}
```

**Step 4: Add "By Topic" popover to toolbar**

When user clicks "By Topic", show a small input popover. On Enter or blur, run `findByTopicIndices` and apply selection.

```tsx
<button
  type="button"
  onClick={() => setShowTopicInput(!showTopicInput)}
  aria-label="Select messages by topic"
  className="px-2 py-0.5 text-[10px] text-purple-600 ..."
>
  By Topic
</button>
{showTopicInput && (
  <input
    type="text"
    placeholder="e.g., authentication"
    aria-label="Topic to search for"
    autoFocus
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        onSelectByTopic(e.currentTarget.value);
        setShowTopicInput(false);
      }
    }}
    className="px-2 py-0.5 text-xs border border-purple-300/50 rounded-md ..."
  />
)}
```

**Step 5: Run tests**

Run: `cd packages/web && pnpm test -- SmartSelectTools && pnpm test -- ContextPickerToolbar`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/web/src/components/context-picker/SmartSelectTools.tsx packages/web/src/components/context-picker/SmartSelectTools.test.tsx packages/web/src/components/context-picker/ContextPickerToolbar.tsx packages/web/src/components/context-picker/ContextPickerDialog.tsx
git commit -m "feat(web): 'By Topic' fuzzy search-based select tool for context picker"
```

---

### Task 13: Add Prompt Preview panel

**Files:**
- Create: `packages/web/src/components/context-picker/PromptPreview.tsx`
- Create: `packages/web/src/components/context-picker/PromptPreview.test.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx`

The Prompt Preview shows a live, read-only view of what the actual prompt will look like — system prompt, selected context messages (formatted), and user fork prompt. This lets the user verify the final output before submitting.

**Step 1: Write failing test**

```typescript
// PromptPreview.test.tsx
import { render, screen } from '@testing-library/react';
import { buildPromptPreview } from './PromptPreview';

describe('buildPromptPreview', () => {
  it('formats context-injection preview with system prompt + selected messages', () => {
    const preview = buildPromptPreview({
      strategy: 'context-injection',
      forkPrompt: 'Continue the auth implementation',
      selectedMessages: [
        { type: 'human', content: 'Set up JWT auth' },
        { type: 'assistant', content: 'Created auth middleware' },
      ],
      systemPrompt: undefined,
    });

    expect(preview).toContain('## Previous Conversation Context');
    expect(preview).toContain('[human] Set up JWT auth');
    expect(preview).toContain('[assistant] Created auth middleware');
    expect(preview).toContain('Continue the auth implementation');
  });

  it('shows simple resume preview', () => {
    const preview = buildPromptPreview({
      strategy: 'resume',
      forkPrompt: 'Fix the bug',
      selectedMessages: [],
    });

    expect(preview).toContain('(Full session history will be preserved)');
    expect(preview).toContain('Fix the bug');
  });

  it('shows jsonl-truncation preview with truncation point', () => {
    const preview = buildPromptPreview({
      strategy: 'jsonl-truncation',
      forkPrompt: 'Continue from here',
      forkAtIndex: 42,
      selectedMessages: [],
    });

    expect(preview).toContain('Messages 0–42 will be preserved');
    expect(preview).toContain('Continue from here');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/web && pnpm test -- PromptPreview`
Expected: FAIL — module not found

**Step 3: Implement buildPromptPreview + PromptPreview component**

```typescript
// PromptPreview.tsx
import React from 'react';
import type { SessionContentMessage } from '@agentctl/shared';

type PreviewInput = {
  strategy: 'resume' | 'jsonl-truncation' | 'context-injection';
  forkPrompt: string;
  forkAtIndex?: number;
  selectedMessages: Pick<SessionContentMessage, 'type' | 'content'>[];
  systemPrompt?: string;
};

export function buildPromptPreview(input: PreviewInput): string {
  const sections: string[] = [];

  if (input.strategy === 'resume') {
    sections.push('--- Strategy: Resume ---');
    sections.push('(Full session history will be preserved)\n');
  } else if (input.strategy === 'jsonl-truncation') {
    sections.push('--- Strategy: JSONL Truncation ---');
    sections.push(`Messages 0–${input.forkAtIndex ?? '?'} will be preserved\n`);
  } else if (input.strategy === 'context-injection') {
    sections.push('--- Strategy: Context Injection ---\n');
    sections.push('## Previous Conversation Context\n');
    for (const msg of input.selectedMessages) {
      sections.push(`[${msg.type}] ${msg.content}\n`);
    }
  }

  if (input.systemPrompt) {
    sections.push(`\n## System Prompt\n${input.systemPrompt}\n`);
  }

  sections.push(`\n## User Prompt\n${input.forkPrompt || '(empty)'}`);

  return sections.join('\n');
}

export const PromptPreview = React.memo(function PromptPreview({
  previewText,
}: {
  previewText: string;
}): React.ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Prompt Preview
      </span>
      <pre className="flex-1 p-3 bg-muted/40 border border-border rounded-md text-[11px] text-foreground font-mono whitespace-pre-wrap overflow-y-auto max-h-48 leading-relaxed">
        {previewText}
      </pre>
    </div>
  );
});
```

**Step 4: Wire into ContextPickerDialog**

Add a collapsible "Preview" section at the bottom of the right panel (both fork and agent tabs) that shows the live prompt preview. Compute `buildPromptPreview(...)` from current state on every render (cheap string concat, no need for memoization unless messages >10k).

**Step 5: Run tests**

Run: `cd packages/web && pnpm test -- PromptPreview && pnpm test -- ContextPickerDialog`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/web/src/components/context-picker/PromptPreview.tsx packages/web/src/components/context-picker/PromptPreview.test.tsx packages/web/src/components/context-picker/ContextPickerDialog.tsx
git commit -m "feat(web): live prompt preview panel in context picker"
```

---

## Phase 4: claude-mem Memory Integration

### Task 14: Add claude-mem query endpoint to control-plane

**Files:**
- Create: `packages/control-plane/src/api/routes/memory.ts`
- Create: `packages/control-plane/src/api/routes/memory.test.ts`
- Modify: `packages/control-plane/src/api/routes/index.ts` (register route)

The CP exposes a `/api/memory/search` endpoint that queries the claude-mem SQLite database at `~/.claude-mem/claude-mem.db`. This keeps the web app decoupled from the file system.

**Step 1: Write failing test**

```typescript
// memory.test.ts
describe('GET /api/memory/search', () => {
  it('returns observations matching query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/search?q=authentication&project=agentctl&limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.observations).toBeInstanceOf(Array);
    expect(body.observations[0]).toHaveProperty('id');
    expect(body.observations[0]).toHaveProperty('title');
    expect(body.observations[0]).toHaveProperty('type');
    expect(body.observations[0]).toHaveProperty('facts');
  });

  it('returns 400 when query is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory/search' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/memory/observations/:id', () => {
  it('returns full observation by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/observations/9090',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.observation).toHaveProperty('narrative');
    expect(body.observation).toHaveProperty('files_modified');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm test -- memory`
Expected: FAIL — route not found

**Step 3: Implement memory routes**

```typescript
// memory.ts
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FastifyInstance } from 'fastify';

const CLAUDE_MEM_DB = join(homedir(), '.claude-mem', 'claude-mem.db');

function getDb(): Database.Database {
  return new Database(CLAUDE_MEM_DB, { readonly: true });
}

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  // Search observations by text query
  app.get('/api/memory/search', async (request, reply) => {
    const { q, project, type, limit } = request.query as {
      q?: string; project?: string; type?: string; limit?: string;
    };
    if (!q) return reply.status(400).send({ error: 'Missing query parameter: q' });

    const db = getDb();
    try {
      const maxResults = Math.min(Number(limit) || 20, 100);
      let sql = `SELECT id, type, title, subtitle, facts, files_modified, created_at
                 FROM observations WHERE 1=1`;
      const params: unknown[] = [];

      // Text search: match title, facts, or narrative
      sql += ` AND (title LIKE ? OR facts LIKE ? OR narrative LIKE ?)`;
      const pattern = `%${q}%`;
      params.push(pattern, pattern, pattern);

      if (project) {
        sql += ` AND project LIKE ?`;
        params.push(`%${project}%`);
      }
      if (type) {
        sql += ` AND type = ?`;
        params.push(type);
      }

      sql += ` ORDER BY created_at_epoch DESC LIMIT ?`;
      params.push(maxResults);

      const rows = db.prepare(sql).all(...params);
      return { observations: rows };
    } finally {
      db.close();
    }
  });

  // Get full observation by ID
  app.get('/api/memory/observations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    try {
      const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(Number(id));
      if (!row) return reply.status(404).send({ error: 'Observation not found' });
      return { observation: row };
    } finally {
      db.close();
    }
  });

  // Get timeline of observations for a session
  app.get('/api/memory/timeline', async (request, reply) => {
    const { sessionId, limit } = request.query as { sessionId?: string; limit?: string };
    if (!sessionId) return reply.status(400).send({ error: 'Missing query parameter: sessionId' });

    const db = getDb();
    try {
      const maxResults = Math.min(Number(limit) || 50, 200);
      const rows = db.prepare(
        `SELECT o.id, o.type, o.title, o.facts, o.files_modified, o.created_at
         FROM observations o
         JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
         WHERE s.content_session_id = ?
         ORDER BY o.created_at_epoch ASC
         LIMIT ?`
      ).all(sessionId, maxResults);
      return { observations: rows };
    } finally {
      db.close();
    }
  });
}
```

**Step 4: Register route in routes/index.ts**

**Step 5: Run tests**

Run: `cd packages/control-plane && pnpm test -- memory`
Expected: PASS (mock the DB in tests)

**Step 6: Commit**

```bash
git add packages/control-plane/src/api/routes/memory.ts packages/control-plane/src/api/routes/memory.test.ts packages/control-plane/src/api/routes/index.ts
git commit -m "feat(cp): claude-mem query endpoints — search, get observation, timeline"
```

---

### Task 15: Add memory API client to web

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

**Step 1: Add API client methods**

```typescript
// In api.ts, ADD:
searchMemory: (params: { q: string; project?: string; type?: string; limit?: number }) =>
  request<{ observations: MemoryObservation[] }>(
    `/api/memory/search?${new URLSearchParams({
      q: params.q,
      ...(params.project ? { project: params.project } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.limit ? { limit: String(params.limit) } : {}),
    }).toString()}`
  ),

getMemoryObservation: (id: number) =>
  request<{ observation: MemoryObservation }>(`/api/memory/observations/${id}`),

getMemoryTimeline: (sessionId: string, limit?: number) =>
  request<{ observations: MemoryObservation[] }>(
    `/api/memory/timeline?sessionId=${sessionId}${limit ? `&limit=${limit}` : ''}`
  ),
```

**Step 2: Add MemoryObservation type**

```typescript
// In packages/shared/src/types/ or inline in api.ts:
export type MemoryObservation = {
  id: number;
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
  title: string;
  subtitle?: string;
  facts?: string;       // JSON array of fact strings
  narrative?: string;
  files_modified?: string; // JSON array of file paths
  created_at: string;
};
```

**Step 3: Add React Query hooks**

```typescript
// In queries.ts, ADD:
export function useMemorySearch(query: string, options?: { project?: string; type?: string }) {
  return useQuery({
    queryKey: ['memory', 'search', query, options],
    queryFn: () => api.searchMemory({ q: query, ...options }),
    enabled: query.length >= 2,
    staleTime: 60_000,  // cache 1 min
  });
}

export function useMemoryTimeline(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['memory', 'timeline', sessionId],
    queryFn: () => api.getMemoryTimeline(sessionId!),
    enabled: !!sessionId,
    staleTime: 60_000,
  });
}
```

**Step 4: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts packages/shared/src/types/
git commit -m "feat(web): memory API client + React Query hooks for claude-mem"
```

---

### Task 16: Add Memory Panel to context picker

**Files:**
- Create: `packages/web/src/components/context-picker/MemoryPanel.tsx`
- Create: `packages/web/src/components/context-picker/MemoryPanel.test.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerToolbar.tsx`

The Memory Panel shows claude-mem observations for the current session's project. Users can search memories, click an observation to auto-highlight corresponding raw messages in the timeline (by matching `files_modified` and `facts` keywords against message content).

**Step 1: Write failing test**

```typescript
// MemoryPanel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryPanel } from './MemoryPanel';
import { matchObservationToMessages } from './MemoryPanel';

describe('matchObservationToMessages', () => {
  const messages = [
    { type: 'human', content: 'Fix the auth middleware in packages/web/src/auth.ts' },
    { type: 'assistant', content: 'Updated the JWT validation logic' },
    { type: 'human', content: 'Now work on the database schema' },
    { type: 'assistant', content: 'Created migration for users table' },
  ];

  it('matches observation files to messages mentioning those files', () => {
    const observation = {
      id: 1,
      type: 'bugfix' as const,
      title: 'Fix auth middleware JWT validation',
      files_modified: '["packages/web/src/auth.ts"]',
      facts: '["JWT validation was missing expiry check"]',
      created_at: '2026-03-09T10:00:00Z',
    };
    const indices = matchObservationToMessages(observation, messages);
    expect(indices).toContain(0);  // mentions auth.ts
    expect(indices).toContain(1);  // mentions JWT validation
  });

  it('returns empty for unrelated observation', () => {
    const observation = {
      id: 2,
      type: 'feature' as const,
      title: 'Add Kubernetes deployment',
      files_modified: '["infra/k8s/deployment.yaml"]',
      facts: '["Added helm chart"]',
      created_at: '2026-03-09T10:00:00Z',
    };
    const indices = matchObservationToMessages(observation, messages);
    expect(indices).toEqual([]);
  });
});

describe('MemoryPanel', () => {
  it('renders observation cards', () => {
    render(
      <MemoryPanel
        observations={[
          { id: 1, type: 'decision', title: 'Use PostgreSQL', created_at: '2026-03-09T10:00:00Z' },
          { id: 2, type: 'bugfix', title: 'Fix auth flow', created_at: '2026-03-09T11:00:00Z' },
        ]}
        isLoading={false}
        onSelectObservation={() => {}}
      />
    );
    expect(screen.getByText('Use PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Fix auth flow')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<MemoryPanel observations={[]} isLoading={true} onSelectObservation={() => {}} />);
    expect(screen.getByText(/searching memories/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/web && pnpm test -- MemoryPanel`
Expected: FAIL — module not found

**Step 3: Implement MemoryPanel + matchObservationToMessages**

```typescript
// MemoryPanel.tsx
import React from 'react';
import type { MemoryObservation } from '@agentctl/shared';
import { fuzzyScore } from '@/lib/fuzzy-search';
import { cn } from '@/lib/utils';

const TYPE_COLORS: Record<string, string> = {
  decision: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  bugfix: 'text-red-600 bg-red-500/10 border-red-500/20',
  feature: 'text-green-600 bg-green-500/10 border-green-500/20',
  refactor: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  discovery: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  change: 'text-gray-600 bg-gray-500/10 border-gray-500/20',
};

export function matchObservationToMessages(
  observation: MemoryObservation,
  messages: { type: string; content: string }[],
): number[] {
  const indices = new Set<number>();

  // Extract keywords from observation
  const keywords: string[] = [];

  // Parse files_modified JSON array
  if (observation.files_modified) {
    try {
      const files = JSON.parse(observation.files_modified) as string[];
      for (const f of files) {
        // Use the filename (last segment) as a keyword
        const filename = f.split('/').pop();
        if (filename) keywords.push(filename);
      }
    } catch { /* ignore parse errors */ }
  }

  // Parse facts JSON array — extract key phrases
  if (observation.facts) {
    try {
      const facts = JSON.parse(observation.facts) as string[];
      for (const fact of facts) {
        // Extract meaningful words (>4 chars) from each fact
        const words = fact.split(/\s+/).filter((w) => w.length > 4);
        keywords.push(...words.slice(0, 5)); // max 5 keywords per fact
      }
    } catch { /* ignore */ }
  }

  // Also use title words as keywords
  const titleWords = observation.title.split(/\s+/).filter((w) => w.length > 3);
  keywords.push(...titleWords);

  // Match keywords against messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const content = msg.content.toLowerCase();

    for (const kw of keywords) {
      if (content.includes(kw.toLowerCase())) {
        indices.add(i);
        break;
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

type MemoryPanelProps = {
  observations: MemoryObservation[];
  isLoading: boolean;
  onSelectObservation: (observation: MemoryObservation) => void;
  selectedObservationId?: number;
};

export const MemoryPanel = React.memo(function MemoryPanel({
  observations,
  isLoading,
  onSelectObservation,
  selectedObservationId,
}: MemoryPanelProps): React.ReactNode {
  if (isLoading) {
    return (
      <div className="p-3 text-xs text-muted-foreground animate-pulse">
        Searching memories...
      </div>
    );
  }

  if (observations.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No matching memories found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2 max-h-48 overflow-y-auto">
      {observations.map((obs) => (
        <button
          key={obs.id}
          type="button"
          onClick={() => onSelectObservation(obs)}
          className={cn(
            'text-left p-2 rounded-md border text-xs transition-colors cursor-pointer',
            selectedObservationId === obs.id
              ? 'ring-2 ring-primary/40'
              : 'hover:bg-muted/50',
            TYPE_COLORS[obs.type] ?? TYPE_COLORS.change,
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-medium uppercase opacity-70">{obs.type}</span>
            <span className="font-medium truncate">{obs.title}</span>
          </div>
        </button>
      ))}
    </div>
  );
});
```

**Step 4: Wire into ContextPickerDialog**

Add a "Memory" section above the smart select buttons in the toolbar area. When the dialog opens, query `useMemoryTimeline(session.claudeSessionId)` to load observations for this session. Also add a memory search input that uses `useMemorySearch`.

When user clicks an observation card:
1. Call `matchObservationToMessages(observation, messages)`
2. Set those indices as selected (additive — don't clear existing selection)
3. Scroll to the first matched message in the virtualizer

**Step 5: Run tests**

Run: `cd packages/web && pnpm test -- MemoryPanel && pnpm test -- ContextPickerDialog`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/web/src/components/context-picker/MemoryPanel.tsx packages/web/src/components/context-picker/MemoryPanel.test.tsx packages/web/src/components/context-picker/ContextPickerDialog.tsx packages/web/src/components/context-picker/ContextPickerToolbar.tsx
git commit -m "feat(web): memory panel in context picker — claude-mem powered auto-select"
```

---

### Task 17: Add memory search input to toolbar

**Files:**
- Modify: `packages/web/src/components/context-picker/ContextPickerToolbar.tsx`
- Modify: `packages/web/src/components/context-picker/ContextPickerDialog.tsx`

**Step 1: Add "Search Memory" input alongside existing message search**

The toolbar already has a message search input. Add a second input (or a toggle) for memory search. When the user types in the memory search, it queries claude-mem via `useMemorySearch` and populates the MemoryPanel.

```tsx
{/* Memory search row */}
<div className="flex items-center gap-2">
  <input
    type="text"
    value={memoryQuery}
    onChange={(e) => onMemoryQueryChange(e.target.value)}
    placeholder="Search memories..."
    aria-label="Search claude-mem observations"
    className="flex-1 px-2.5 py-1.5 bg-purple-500/5 text-foreground border border-purple-300/30 rounded-md text-xs outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 transition-colors"
  />
</div>
```

**Step 2: Wire debounced memory search**

In ContextPickerDialog, debounce the memory query (300ms) before calling `useMemorySearch`. Display results in the MemoryPanel below the toolbar.

**Step 3: Run tests**

Run: `cd packages/web && pnpm test -- ContextPickerToolbar && pnpm test -- ContextPickerDialog`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/web/src/components/context-picker/ContextPickerToolbar.tsx packages/web/src/components/context-picker/ContextPickerDialog.tsx
git commit -m "feat(web): memory search input in context picker toolbar"
```

---

### Task 18: Final integration + update exports

**Files:**
- Modify: `packages/web/src/components/context-picker/index.ts`
- Run: full test suite

**Step 1: Update barrel exports**

```typescript
// index.ts
export { ContextPickerDialog } from './ContextPickerDialog';
export type { ForkSubmitConfig, CreateAgentSubmitConfig, ContextPickerDialogProps } from './ContextPickerDialog';
export { PromptPreview, buildPromptPreview } from './PromptPreview';
export { MemoryPanel, matchObservationToMessages } from './MemoryPanel';
export { TimelineMarkerRow, computeTimelineMarkers } from './TimelineMarkers';
export { findKeyDecisionIndices, findByTopicIndices } from './SmartSelectTools';
```

**Step 2: Run full test suite**

Run: `cd packages/web && pnpm test`
Expected: ALL PASS

Run: `cd packages/control-plane && pnpm test`
Expected: ALL PASS

Run: `pnpm tsc --noEmit` (from monorepo root)
Expected: 0 errors

Run: `pnpm biome check .`
Expected: 0 errors

**Step 3: Commit**

```bash
git add packages/web/src/components/context-picker/index.ts
git commit -m "chore(web): update context-picker barrel exports for new components"
```

---

## Dependency Graph

```
Phase 1 (Foundation):
  Task 1 (shared types) ──► Task 2 (CP routes) ──► Task 4 (web model-options)
  Task 3 (ConvertToAgentForm fix) — independent

Phase 2 (Unified Dialog):
  Task 4 ──► Task 5 (dialog types) ──► Task 6 (runtime selector)
  Task 5 ──► Task 7 (SessionHeader) ──► Task 9 (dead code cleanup)
  Task 5 ──► Task 8 (SessionsPage)  ──► Task 9

Phase 3 (Smart Tools):
  Task 5 ──► Task 10 (timeline markers)
  Task 5 ──► Task 11 (key decisions)
  Task 5 ──► Task 12 (by topic)
  Task 5 ──► Task 13 (prompt preview)
  (Tasks 10-13 are independent of each other)

Phase 4 (Memory):
  Task 14 (CP memory routes) ──► Task 15 (web API client) ──► Task 16 (memory panel)
  Task 16 ──► Task 17 (memory search)
  Task 17 ──► Task 18 (final integration)
```

**Parallelization opportunities:**
- Phase 1 tasks 1-3 can run in parallel (different packages)
- Phase 3 tasks 10-13 can all run in parallel (independent components)
- Phase 4 task 14 (CP) can start while Phase 2 is still in progress

---

## File Inventory

### New Files (10)
| File | Purpose |
|------|---------|
| `packages/web/src/components/context-picker/TimelineMarkers.tsx` | Timeline gap/turn markers |
| `packages/web/src/components/context-picker/TimelineMarkers.test.tsx` | Tests |
| `packages/web/src/components/context-picker/SmartSelectTools.tsx` | Key Decisions + By Topic logic |
| `packages/web/src/components/context-picker/SmartSelectTools.test.tsx` | Tests |
| `packages/web/src/components/context-picker/PromptPreview.tsx` | Live prompt preview |
| `packages/web/src/components/context-picker/PromptPreview.test.tsx` | Tests |
| `packages/web/src/components/context-picker/MemoryPanel.tsx` | Memory observation cards |
| `packages/web/src/components/context-picker/MemoryPanel.test.tsx` | Tests |
| `packages/control-plane/src/api/routes/memory.ts` | claude-mem query endpoints |
| `packages/control-plane/src/api/routes/memory.test.ts` | Tests |

### Modified Files (12)
| File | Changes |
|------|---------|
| `packages/shared/src/types/agent.ts` | Add AgentRuntime, AGENT_RUNTIMES |
| `packages/shared/src/index.ts` | Export new types |
| `packages/control-plane/src/api/routes/agents.ts` | Runtime field + type validation |
| `packages/control-plane/src/api/routes/index.ts` | Register memory routes |
| `packages/web/src/lib/model-options.ts` | Re-export AGENT_RUNTIMES |
| `packages/web/src/lib/api.ts` | Memory API client methods |
| `packages/web/src/lib/queries.ts` | Memory React Query hooks |
| `packages/web/src/components/context-picker/ContextPickerDialog.tsx` | Unified tabs, smart tools, memory |
| `packages/web/src/components/context-picker/ContextPickerToolbar.tsx` | Smart select buttons, memory search |
| `packages/web/src/components/context-picker/index.ts` | Updated exports |
| `packages/web/src/components/SessionHeader.tsx` | Unified dialog integration |
| `packages/web/src/views/SessionsPage.tsx` | Unified dialog + fix naming |

### Deleted Files (2)
| File | Reason |
|------|--------|
| `packages/web/src/components/ConvertToAgentForm.tsx` | Replaced by unified dialog |
| `packages/web/src/components/ConvertToAgentForm.test.tsx` | Tests for deleted component |

---

## Estimated Commits: 18
## Estimated New Test Count: ~45-60 new tests
