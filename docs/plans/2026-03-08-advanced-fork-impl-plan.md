# Advanced Fork / Context Picker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify fork + create-agent into one powerful ContextPickerDialog with virtualized scroll, search/filter, fork-here timeline selection, token estimation, context compression, and JSONL truncation fork strategy.

**Architecture:** Replace `ForkContextPicker` with `ContextPickerDialog` supporting two modes (`fork` | `create-agent`). Left panel: virtualized message list with toolbar. Right panel: mode-specific config. Backend: enhanced `POST /sessions/:id/fork` with `strategy` field dispatching to JSONL truncation or system prompt injection.

**Tech Stack:** React 19, @tanstack/react-virtual, @tanstack/react-query, Fastify, Node.js fs, pino

**Design doc:** `docs/plans/2026-03-08-advanced-fork-design.md`

---

## Task 1: Install @tanstack/react-virtual

**Files:**
- Modify: `packages/web/package.json`

**Step 1: Add dependency**

```bash
cd packages/web && pnpm add @tanstack/react-virtual
```

**Step 2: Verify install**

```bash
pnpm ls @tanstack/react-virtual
```

Expected: Shows `@tanstack/react-virtual` in dependencies.

**Step 3: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @tanstack/react-virtual for virtualized lists"
```

---

## Task 2: Create ContextMessageRow component

The individual row rendered inside the virtualized list. Displays a message with checkbox, type badge, content preview, timestamp, and a "Fork here" button on hover.

**Files:**
- Create: `packages/web/src/components/context-picker/ContextMessageRow.tsx`
- Create: `packages/web/src/components/context-picker/ContextMessageRow.test.tsx`

**Step 1: Write tests**

Test cases:
- Renders checkbox, type label, content preview, timestamp
- Checkbox reflects `checked` prop
- Clicking checkbox calls `onToggle(index)`
- "Fork here" button visible on hover area, calls `onForkHere(index)`
- Shift+click calls `onShiftClick(index)`
- Long content is truncated to 120 chars
- Shows toolName badge when present
- Dimmed styling when `checked=false`
- Thinking messages show char count instead of content

```typescript
// packages/web/src/components/context-picker/ContextMessageRow.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));
vi.mock('@/lib/message-styles', () => ({
  getMessageStyle: (type: string) => ({
    label: type === 'human' ? 'You' : type === 'assistant' ? 'Claude' : type,
    textClass: 'text-muted',
  }),
}));

import { ContextMessageRow } from './ContextMessageRow';

const baseMsg = { type: 'human' as const, content: 'Fix the bug', timestamp: '2026-03-08T14:10:00Z' };

describe('ContextMessageRow', () => {
  it('renders checkbox, label, content, and time', () => {
    render(<ContextMessageRow message={baseMsg} index={0} checked onToggle={vi.fn()} onForkHere={vi.fn()} onShiftClick={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeDefined();
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('Fix the bug')).toBeDefined();
    expect(screen.getByText('14:10')).toBeDefined(); // time portion
  });

  it('calls onToggle when checkbox clicked', () => {
    const onToggle = vi.fn();
    render(<ContextMessageRow message={baseMsg} index={3} checked onToggle={onToggle} onForkHere={vi.fn()} onShiftClick={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(3);
  });

  it('calls onForkHere when fork button clicked', () => {
    const onForkHere = vi.fn();
    render(<ContextMessageRow message={baseMsg} index={5} checked onToggle={vi.fn()} onForkHere={onForkHere} onShiftClick={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Fork from here'));
    expect(onForkHere).toHaveBeenCalledWith(5);
  });

  it('truncates content longer than 120 chars', () => {
    const longMsg = { ...baseMsg, content: 'A'.repeat(200) };
    render(<ContextMessageRow message={longMsg} index={0} checked onToggle={vi.fn()} onForkHere={vi.fn()} onShiftClick={vi.fn()} />);
    expect(screen.getByText(/^A+\.\.\.$/)).toBeDefined();
  });

  it('calls onShiftClick on shift+click', () => {
    const onShiftClick = vi.fn();
    render(<ContextMessageRow message={baseMsg} index={2} checked onToggle={vi.fn()} onForkHere={vi.fn()} onShiftClick={onShiftClick} />);
    fireEvent.click(screen.getByRole('checkbox'), { shiftKey: true });
    expect(onShiftClick).toHaveBeenCalledWith(2);
  });
});
```

**Step 2: Run tests, verify they fail**

```bash
cd packages/web && pnpm vitest run src/components/context-picker/ContextMessageRow.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implement ContextMessageRow**

```typescript
// packages/web/src/components/context-picker/ContextMessageRow.tsx
'use client';

import type React from 'react';
import { useCallback } from 'react';
import type { SessionContentMessage } from '@/lib/api';
import { getMessageStyle } from '@/lib/message-styles';
import { cn } from '@/lib/utils';

type ContextMessageRowProps = {
  message: SessionContentMessage;
  index: number;
  checked: boolean;
  onToggle: (index: number) => void;
  onForkHere: (index: number) => void;
  onShiftClick: (index: number) => void;
  style?: React.CSSProperties; // for virtualizer positioning
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

export function ContextMessageRow({
  message,
  index,
  checked,
  onToggle,
  onForkHere,
  onShiftClick,
  style,
}: ContextMessageRowProps): React.JSX.Element {
  const msgStyle = getMessageStyle(message.type);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.shiftKey) {
        onShiftClick(index);
      } else {
        onToggle(index);
      }
    },
    [index, onToggle, onShiftClick],
  );

  const handleForkHere = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onForkHere(index);
    },
    [index, onForkHere],
  );

  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      style={style}
      className={cn(
        'group flex items-start gap-2.5 px-2.5 py-2 rounded-md transition-colors border-l-2',
        checked
          ? 'bg-muted/50 border-l-blue-500'
          : 'border-l-transparent hover:bg-muted/30 opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={handleClick}
        readOnly
        className="mt-0.5 accent-blue-500 shrink-0 cursor-pointer"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn('text-[10px] font-medium', msgStyle.textClass)}>
            {msgStyle.label}
          </span>
          {message.toolName && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {message.toolName}
            </span>
          )}
          {time && (
            <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">{time}</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
          {message.type === 'thinking'
            ? `[Thinking: ${message.content.length} chars]`
            : truncate(message.content, 120)}
        </p>
      </div>
      <button
        type="button"
        title="Fork from here"
        onClick={handleForkHere}
        className="shrink-0 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-[9px] text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded cursor-pointer hover:bg-blue-500/20 transition-opacity"
      >
        Fork here
      </button>
    </div>
  );
}
```

**Step 4: Run tests, verify pass**

```bash
cd packages/web && pnpm vitest run src/components/context-picker/ContextMessageRow.test.tsx
```

**Step 5: Commit**

```bash
git add packages/web/src/components/context-picker/
git commit -m "feat(web): add ContextMessageRow component with fork-here button"
```

---

## Task 3: Create ContextPickerToolbar component

Search input, filter dropdown, and bulk selection buttons.

**Files:**
- Create: `packages/web/src/components/context-picker/ContextPickerToolbar.tsx`
- Create: `packages/web/src/components/context-picker/ContextPickerToolbar.test.tsx`

**Step 1: Write tests**

Test cases:
- Renders search input, filter dropdown, Select All, Deselect All, Invert buttons
- Typing in search calls `onSearchChange`
- Changing filter calls `onFilterChange`
- Select All / Deselect All / Invert call their respective handlers
- Shows total/selected/token counts
- Token count color: green (<50k), yellow (50k-100k), red (>100k)

**Step 2: Implement ContextPickerToolbar**

Props:
```typescript
type ContextPickerToolbarProps = {
  totalMessages: number;
  selectedCount: number;
  estimatedTokens: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterType: string; // 'all' | 'human' | 'assistant' | 'tool_use' | 'tool_result' | 'thinking'
  onFilterChange: (type: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onInvert: () => void;
};
```

Renders: search input with aria-label, `<select>` for filter, three buttons, stats bar showing `"847 messages | 234 selected | ~48.2k tokens"`.

Token formatting: `estimatedTokens < 1000 → exact`, `>= 1000 → ~X.Xk`.
Token color: `< 50_000 → text-green-600`, `50_000-100_000 → text-yellow-600`, `>= 100_000 → text-red-600`.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git commit -m "feat(web): add ContextPickerToolbar with search, filter, and bulk actions"
```

---

## Task 4: Create ContextSummaryBar component

Footer bar showing context stats and compression toggles.

**Files:**
- Create: `packages/web/src/components/context-picker/ContextSummaryBar.tsx`
- Create: `packages/web/src/components/context-picker/ContextSummaryBar.test.tsx`

**Step 1: Write tests**

Test cases:
- Shows selected count, token estimate, cost estimate
- Cost formula: `tokens * 0.003 / 1000` (input pricing for Opus)
- Compression toggle buttons: "Hide tool results", "Collapse thinking"
- Clicking toggles calls `onToggleCompression` with flag name

**Step 2: Implement ContextSummaryBar**

Props:
```typescript
type ContextSummaryBarProps = {
  selectedCount: number;
  estimatedTokens: number;
  hideToolResults: boolean;
  collapseThinking: boolean;
  onToggleHideToolResults: () => void;
  onToggleCollapseThinking: () => void;
};
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git commit -m "feat(web): add ContextSummaryBar with token estimate and compression toggles"
```

---

## Task 5: Create ForkConfigPanel (right sidebar for fork mode)

**Files:**
- Create: `packages/web/src/components/context-picker/ForkConfigPanel.tsx`
- Create: `packages/web/src/components/context-picker/ForkConfigPanel.test.tsx`

**Step 1: Write tests**

Test cases:
- Renders fork prompt textarea, model dropdown, strategy display
- Shows auto-detected strategy label based on `detectedStrategy` prop
- Shows source session info (session ID, agent name, claude session ID)
- Submit button disabled when prompt is empty
- Shows "Forking..." when isSubmitting=true

**Step 2: Implement ForkConfigPanel**

Props:
```typescript
type ForkConfigPanelProps = {
  session: Session;
  forkPrompt: string;
  onForkPromptChange: (prompt: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  detectedStrategy: 'jsonl-truncation' | 'context-injection' | 'resume';
  isSubmitting: boolean;
  onSubmit: () => void;
};
```

Reuse `MODEL_OPTIONS_WITH_DEFAULT` from `@/lib/model-options`.

Strategy display (read-only indicator):
- `jsonl-truncation` → "JSONL Truncation — perfect fidelity, forking from exact conversation point"
- `context-injection` → "Context Injection — cherry-picked messages injected as system prompt"
- `resume` → "Full Resume — all messages, continuing existing conversation"

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git commit -m "feat(web): add ForkConfigPanel for fork mode sidebar"
```

---

## Task 6: Create ContextPickerDialog (unified component)

The main dialog that composes all sub-components and manages state.

**Files:**
- Create: `packages/web/src/components/context-picker/ContextPickerDialog.tsx`
- Create: `packages/web/src/components/context-picker/index.ts` (barrel export)

**Step 1: Implement ContextPickerDialog**

Props:
```typescript
type ContextPickerDialogProps = {
  mode: 'fork' | 'create-agent';
  session: Session;
  messages: SessionContentMessage[];
  open: boolean;
  onClose: () => void;
  onForkSubmit?: (config: {
    prompt: string;
    model?: string;
    strategy: 'jsonl-truncation' | 'context-injection' | 'resume';
    forkAtIndex?: number;
    selectedMessages?: SessionContentMessage[];
  }) => void;
  onCreateAgentSubmit?: (config: {
    name: string;
    type: string;
    model?: string;
    systemPrompt?: string;
    selectedMessageIds: number[];
  }) => void;
  isSubmitting?: boolean;
};
```

**Key state:**
```typescript
const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(messages.map((_, i) => i)));
const [searchQuery, setSearchQuery] = useState('');
const [filterType, setFilterType] = useState('all');
const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null); // for shift+click range
const [hideToolResults, setHideToolResults] = useState(false);
const [collapseThinking, setCollapseThinking] = useState(false);
// Fork mode state
const [forkPrompt, setForkPrompt] = useState('');
const [forkModel, setForkModel] = useState(session.model ?? '');
// Create agent mode state (reuse existing fields from ForkContextPicker)
const [agentName, setAgentName] = useState(`${session.agentName ?? 'agent'}-fork`);
const [agentType, setAgentType] = useState('adhoc');
const [agentModel, setAgentModel] = useState(session.model ?? '');
const [systemPrompt, setSystemPrompt] = useState('');
```

**Key logic:**

```typescript
// Filtered messages (search + type filter)
const filteredMessages = useMemo(() => {
  return messages.map((msg, idx) => ({ msg, idx })).filter(({ msg }) => {
    if (filterType !== 'all' && msg.type !== filterType) return false;
    if (searchQuery && !msg.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
}, [messages, filterType, searchQuery]);

// Auto-detect fork strategy
const detectedStrategy = useMemo((): 'jsonl-truncation' | 'context-injection' | 'resume' => {
  const sortedIds = Array.from(selectedIds).sort((a, b) => a - b);
  if (sortedIds.length === messages.length) return 'resume';
  // Check if contiguous from 0
  const isContiguousFromStart = sortedIds.every((id, i) => id === i);
  return isContiguousFromStart ? 'jsonl-truncation' : 'context-injection';
}, [selectedIds, messages.length]);

// Token estimation: chars / 3.5
const estimatedTokens = useMemo(() => {
  let totalChars = 0;
  for (const id of selectedIds) {
    const msg = messages[id];
    if (msg) {
      if (hideToolResults && (msg.type === 'tool_result')) continue;
      if (collapseThinking && msg.type === 'thinking') {
        totalChars += 30; // "[Thinking: N chars]" placeholder
        continue;
      }
      totalChars += msg.content.length;
    }
  }
  return Math.round(totalChars / 3.5);
}, [selectedIds, messages, hideToolResults, collapseThinking]);

// Fork here — select 0..index inclusive, deselect rest
const handleForkHere = useCallback((index: number) => {
  const newSet = new Set<number>();
  for (let i = 0; i <= index; i++) newSet.add(i);
  setSelectedIds(newSet);
}, []);

// Shift+click range selection
const handleShiftClick = useCallback((index: number) => {
  if (lastClickedIndex === null) {
    onToggle(index);
    return;
  }
  const start = Math.min(lastClickedIndex, index);
  const end = Math.max(lastClickedIndex, index);
  setSelectedIds(prev => {
    const next = new Set(prev);
    for (let i = start; i <= end; i++) next.add(i);
    return next;
  });
}, [lastClickedIndex]);
```

**Virtualized list:** Use `useVirtualizer` from `@tanstack/react-virtual`:
```typescript
const parentRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: filteredMessages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 56, // ~56px per row
  overscan: 20,
});
```

**Layout:** Same two-column layout as current ForkContextPicker. Left: toolbar + virtualized list + summary bar. Right: `ForkConfigPanel` (fork mode) or existing agent config fields (create-agent mode).

**Step 2: Create barrel export**

```typescript
// packages/web/src/components/context-picker/index.ts
export { ContextPickerDialog } from './ContextPickerDialog';
```

**Step 3: Verify TypeScript compiles**

```bash
cd packages/web && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/web/src/components/context-picker/
git commit -m "feat(web): add ContextPickerDialog unifying fork + create-agent"
```

---

## Task 7: Write ContextPickerDialog tests

**Files:**
- Create: `packages/web/src/components/context-picker/ContextPickerDialog.test.tsx`

**Step 1: Write comprehensive tests**

Test cases:

**Rendering:**
- Renders nothing when `open=false`
- Shows dialog title based on mode: "Fork Session" vs "Create Agent from Session"
- Shows search input and filter dropdown
- Shows virtualized message list
- Shows footer summary bar

**Fork mode:**
- Shows ForkConfigPanel with prompt textarea
- Auto-detects strategy: all selected → "resume"
- Auto-detects strategy: contiguous from start → "jsonl-truncation"
- Auto-detects strategy: non-contiguous → "context-injection"
- Submit calls `onForkSubmit` with strategy, forkAtIndex, prompt, model
- Submit disabled when prompt empty

**Create-agent mode:**
- Shows agent name, type, model, system prompt fields
- Submit calls `onCreateAgentSubmit` with config

**Selection:**
- "Fork here" on message index N → selects 0..N, deselects N+1..end
- Shift+click selects range
- Select All / Deselect All / Invert work
- Filter hides non-matching messages
- Search filters by content

**Token estimation:**
- Shows estimated token count
- Updates when selection changes
- "Hide tool results" toggle reduces token count
- "Collapse thinking" toggle reduces token count

**Step 2: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/context-picker/ContextPickerDialog.test.tsx
```

**Step 3: Fix any failures, then commit**

```bash
git commit -m "test(web): add comprehensive ContextPickerDialog tests"
```

---

## Task 8: Enhance web API client for advanced fork

**Files:**
- Modify: `packages/web/src/lib/api.ts` (forkSession method)
- Modify: `packages/web/src/lib/queries.ts` (useForkSession hook)

**Step 1: Update `api.forkSession`**

In `packages/web/src/lib/api.ts`, change the existing `forkSession` method:

```typescript
// OLD:
forkSession: (id: string, prompt: string) =>
  request<{ ok: boolean; sessionId: string; session: Session; forkedFrom: string }>(
    `/api/sessions/${id}/fork`,
    { method: 'POST', body: JSON.stringify({ prompt }) },
  ),

// NEW:
forkSession: (id: string, body: {
  prompt: string;
  model?: string;
  strategy?: 'jsonl-truncation' | 'context-injection' | 'resume';
  forkAtIndex?: number;
  selectedMessages?: Array<{ type: string; content: string; toolName?: string; timestamp?: string }>;
}) =>
  request<{ ok: boolean; sessionId: string; session: Session; forkedFrom: string }>(
    `/api/sessions/${id}/fork`,
    { method: 'POST', body: JSON.stringify(body) },
  ),
```

**Step 2: Update `useForkSession` in queries.ts**

```typescript
// OLD:
mutationFn: ({ id, prompt }: { id: string; prompt: string }) => api.forkSession(id, prompt),

// NEW:
mutationFn: ({ id, ...body }: { id: string; prompt: string; model?: string; strategy?: 'jsonl-truncation' | 'context-injection' | 'resume'; forkAtIndex?: number; selectedMessages?: Array<{ type: string; content: string; toolName?: string; timestamp?: string }> }) => api.forkSession(id, body),
```

**Step 3: Update SessionHeader `handleFork` to pass body object**

In `packages/web/src/components/SessionHeader.tsx`, change the existing `handleFork`:

```typescript
// OLD:
forkSession.mutate({ id: session.id, prompt: forkPrompt.trim() }, { ... });

// NEW:
forkSession.mutate({ id: session.id, prompt: forkPrompt.trim(), strategy: 'resume' }, { ... });
```

This ensures the old simple fork still works while the API is now extended.

**Step 4: Verify TypeScript compiles + existing tests pass**

```bash
cd packages/web && npx tsc --noEmit && pnpm vitest run
```

**Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts packages/web/src/components/SessionHeader.tsx
git commit -m "feat(web): extend fork API client with strategy and context selection"
```

---

## Task 9: Enhance control plane fork endpoint

**Files:**
- Modify: `packages/control-plane/src/api/routes/sessions.ts` (POST /:sessionId/fork)

**Step 1: Extend the fork endpoint body to accept new fields**

In the fork route handler (~line 856-1020), add support for:
- `strategy?: 'jsonl-truncation' | 'context-injection' | 'resume'`
- `forkAtIndex?: number`
- `selectedMessages?: Array<{ type: string; content: string; toolName?: string; timestamp?: string }>`

**Behavior by strategy:**

**`resume` (default, current behavior):** No change — dispatches to worker with `resumeSessionId: parent.claudeSessionId`.

**`jsonl-truncation`:** Dispatches to worker with new body field `forkAtIndex` so the worker can create a truncated JSONL copy.

```typescript
// In the worker dispatch body:
body: JSON.stringify({
  sessionId: newSessionId,
  agentId: parent.agentId,
  projectPath: parent.projectPath,
  model: overrideModel ?? parent.model ?? null,
  prompt,
  resumeSessionId: parent.claudeSessionId,
  forkAtIndex: strategy === 'jsonl-truncation' ? forkAtIndex : undefined,
  accountCredential,
  accountProvider,
}),
```

**`context-injection`:** Format selected messages into a system prompt string and pass as config.systemPrompt.

```typescript
if (strategy === 'context-injection' && selectedMessages?.length) {
  const contextLines = ['## Previous Conversation Context\n'];
  for (const msg of selectedMessages) {
    const role = msg.type === 'human' ? 'User' : msg.type === 'assistant' ? 'Assistant' : 'Tool';
    contextLines.push(`### ${role}${msg.timestamp ? ` (${msg.timestamp})` : ''}`);
    if (msg.toolName) contextLines.push(`Tool: ${msg.toolName}`);
    contextLines.push(msg.content, '');
  }
  // Pass as systemPrompt — the worker will use --append-system-prompt
  const systemPrompt = contextLines.join('\n');
  // Don't use resumeSessionId — start fresh session with context
  workerBody.systemPrompt = systemPrompt;
  delete workerBody.resumeSessionId;
}
```

**Step 2: Write tests for the new strategy handling**

Add test cases to the existing sessions.test.ts (in CP) or create new ones:
- Fork with `strategy: 'resume'` → same as before (backward compatible)
- Fork with `strategy: 'jsonl-truncation'` → passes `forkAtIndex` to worker
- Fork with `strategy: 'context-injection'` → passes `systemPrompt`, no `resumeSessionId`
- Fork with missing prompt → 400

**Step 3: Run CP tests**

```bash
cd packages/control-plane && pnpm vitest run
```

**Step 4: Commit**

```bash
git add packages/control-plane/src/api/routes/sessions.ts
git commit -m "feat(cp): extend fork endpoint with strategy, forkAtIndex, and context injection"
```

---

## Task 10: Add worker JSONL truncation fork support

**Files:**
- Modify: `packages/agent-worker/src/api/routes/sessions.ts` (POST /api/sessions)
- Modify: `packages/agent-worker/src/runtime/cli-session-manager.ts`

**Step 1: Handle `forkAtIndex` in worker session creation**

In the `POST /api/sessions` handler, when `forkAtIndex` is provided along with `resumeSessionId`:

1. Find the parent JSONL file using `findSessionJsonl(resumeSessionId, projectPath)`
2. Read all lines
3. Parse lines and count user-visible messages using existing `parseJsonlEntry`
4. Write truncated JSONL to new file: `<sessionId>.jsonl` in the same directory
5. Use `--resume <sessionId>` (the new session ID, not the parent)

```typescript
// In POST /api/sessions handler, after extracting body fields:
if (forkAtIndex !== undefined && resumeSessionId) {
  const parentJsonlPath = findSessionJsonl(resumeSessionId, projectPath);
  if (!parentJsonlPath) {
    return reply.code(400).send({ error: 'Parent session JSONL not found for truncation' });
  }

  const raw = readFileSync(parentJsonlPath, 'utf-8');
  const allLines = raw.split('\n').filter(l => l.trim());

  // Count messages per line and include lines up to forkAtIndex
  let msgCount = 0;
  const truncatedLines: string[] = [];
  for (const line of allLines) {
    const parsed = JSON.parse(line);
    const msgs = parseJsonlEntry(parsed);
    if (msgCount + msgs.length <= forkAtIndex + 1) {
      truncatedLines.push(line);
      msgCount += msgs.length;
    } else {
      // Partial line: need to check if we should include it
      // For simplicity, include the whole line if any of its messages are within range
      truncatedLines.push(line);
      break;
    }
  }

  // Write truncated JSONL next to the parent
  const dir = dirname(parentJsonlPath);
  const newJsonlPath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(newJsonlPath, truncatedLines.join('\n') + '\n');

  // Override resumeSessionId to point to the new truncated file
  effectiveResumeSessionId = sessionId;
}
```

**Step 2: Handle `systemPrompt` in worker session creation**

When `systemPrompt` is present in the body (from context-injection strategy):

```typescript
// In the session start options:
const startOptions = {
  sessionId,
  prompt,
  config: {
    ...config,
    systemPrompt: body.systemPrompt ?? config?.systemPrompt,
  },
  // No resumeSessionId for context-injection
};
```

The existing `cli-session-manager.ts:545-547` already handles `config.systemPrompt` → `--append-system-prompt`.

**Step 3: Add the `forkAtIndex` and `systemPrompt` fields to the body type**

In `packages/agent-worker/src/api/routes/sessions.ts`, extend `CreateSessionBody`:

```typescript
type CreateSessionBody = {
  sessionId: string;
  agentId: string;
  projectPath: string;
  prompt: string;
  model?: string | null;
  resumeSessionId?: string | null;
  accountCredential?: string | null;
  accountProvider?: string | null;
  // NEW:
  forkAtIndex?: number;
  systemPrompt?: string;
};
```

**Step 4: Write tests**

Test cases:
- Session creation with `forkAtIndex` → creates truncated JSONL and resumes from it
- Session creation with `systemPrompt` → passes to CLI as `--append-system-prompt`
- `forkAtIndex` without `resumeSessionId` → ignored (no-op)

**Step 5: Run worker tests**

```bash
cd packages/agent-worker && pnpm vitest run
```

**Step 6: Commit**

```bash
git add packages/agent-worker/src/api/routes/sessions.ts
git commit -m "feat(worker): add JSONL truncation fork and system prompt injection support"
```

---

## Task 11: Wire ContextPickerDialog into SessionHeader (fork mode)

**Files:**
- Modify: `packages/web/src/components/SessionHeader.tsx`
- Modify: `packages/web/src/views/SessionDetailView.tsx`

**Step 1: Replace the simple fork input with ContextPickerDialog**

In `SessionHeader.tsx`:
- Remove the inline fork prompt input + button (lines ~421-468)
- Add state for `showContextPicker` and `contextPickerMessages`
- When "Fork" button is clicked, load all messages via `api.getSessionContent` with `limit: 10000`
- Open `ContextPickerDialog` in `mode='fork'`

```typescript
import { ContextPickerDialog } from '@/components/context-picker';
```

In the `handleFork` (renamed from existing), call the enhanced `forkSession.mutate` with the strategy and context from the dialog.

**Step 2: Wire into SessionDetailView**

The SessionDetailView already has `content.data?.messages`. Pass these to SessionHeader or lift the ContextPickerDialog to the view level.

**Step 3: Verify existing SessionHeader tests still pass**

```bash
cd packages/web && pnpm vitest run src/components/SessionHeader.test.tsx
```

**Step 4: Commit**

```bash
git commit -m "feat(web): wire ContextPickerDialog into SessionHeader for fork mode"
```

---

## Task 12: Wire ContextPickerDialog into SessionsPage (create-agent mode)

**Files:**
- Modify: `packages/web/src/views/SessionsPage.tsx`

**Step 1: Replace ForkContextPicker with ContextPickerDialog**

In `SessionsPage.tsx`:
- Change import from `ForkContextPicker` to `ContextPickerDialog`
- Update `openForkPicker` to load messages with `limit: 10000` (was 200)
- Pass `mode='create-agent'` to the dialog
- Keep existing `handleForkSubmit` logic (creates agent)

```typescript
// Replace:
import { ForkContextPicker } from '../components/ForkContextPicker';
// With:
import { ContextPickerDialog } from '../components/context-picker';

// In JSX, replace:
<ForkContextPicker ... />
// With:
<ContextPickerDialog mode="create-agent" ... />
```

**Step 2: Update the openForkPicker to load more messages**

```typescript
const result = await api.getSessionContent(selected.claudeSessionId, {
  machineId: selected.machineId,
  limit: 10000, // was 200
  projectPath: selected.projectPath ?? undefined,
});
```

**Step 3: Run tests**

```bash
cd packages/web && pnpm vitest run src/views/SessionsPage.test.tsx
```

Fix any test mocks referencing the old `ForkContextPicker`.

**Step 4: Commit**

```bash
git commit -m "feat(web): replace ForkContextPicker with ContextPickerDialog in SessionsPage"
```

---

## Task 13: Delete old ForkContextPicker

**Files:**
- Delete: `packages/web/src/components/ForkContextPicker.tsx`
- Delete: `packages/web/src/components/ForkContextPicker.test.tsx`
- Modify: `packages/web/src/views/SessionDetailView.test.tsx` (update mock)

**Step 1: Remove old files**

```bash
rm packages/web/src/components/ForkContextPicker.tsx packages/web/src/components/ForkContextPicker.test.tsx
```

**Step 2: Update SessionDetailView.test.tsx mock**

Change:
```typescript
vi.mock('@/components/ForkContextPicker', () => ({
  ForkContextPicker: () => <div data-testid="fork-context-picker" />,
}));
```
To:
```typescript
vi.mock('@/components/context-picker', () => ({
  ContextPickerDialog: () => <div data-testid="context-picker-dialog" />,
}));
```

**Step 3: Verify all tests pass**

```bash
cd packages/web && pnpm vitest run
```

**Step 4: Verify TypeScript compiles**

```bash
cd packages/web && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git commit -m "refactor(web): remove old ForkContextPicker (replaced by ContextPickerDialog)"
```

---

## Task 14: E2E smoke tests for fork dialog

**Files:**
- Modify: `packages/web/e2e/smoke.spec.ts`

**Step 1: Add e2e tests for the new fork dialog**

Test cases (with mocked API — same pattern as existing e2e tests):
- Fork button opens ContextPickerDialog in fork mode
- Create Agent button opens ContextPickerDialog in create-agent mode
- Search input filters message list
- Filter dropdown filters by message type
- "Fork here" button updates selection (all before are checked, all after unchecked)
- Token count displayed in footer
- Cancel closes dialog

**Step 2: Run e2e tests**

```bash
cd packages/web && pnpm test:e2e
```

**Step 3: Commit**

```bash
git commit -m "test(web): add e2e smoke tests for advanced fork dialog"
```

---

## Task 15: Final verification and push

**Step 1: Run all tests across all packages**

```bash
cd packages/shared && pnpm vitest run
cd packages/control-plane && pnpm vitest run
cd packages/agent-worker && pnpm vitest run
cd packages/web && pnpm vitest run
cd packages/web && pnpm test:e2e
```

**Step 2: Verify TypeScript and biome across all packages**

```bash
npx biome check packages/
cd packages/web && npx tsc --noEmit
cd packages/control-plane && npx tsc --noEmit
cd packages/agent-worker && npx tsc --noEmit
```

**Step 3: Push to remote**

```bash
git push
```
