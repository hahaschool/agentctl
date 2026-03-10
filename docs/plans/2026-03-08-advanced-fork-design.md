> ⚠️ **ARCHIVED** — This plan has been fully implemented. Kept for historical reference.

# Advanced Fork / Context Picker Design

**Date:** 2026-03-08
**Status:** Design
**Branch:** `feat/nextjs-migration`

## Problem

Current fork is too primitive:
- Fork button in SessionHeader: prompt-only input, uses `--resume` with full history (no control)
- ForkContextPicker: message checkboxes exist but only used for "Create Agent" (not fork)
- 200 message limit — long sessions can't be fully browsed
- No search, no type filters, no range selection, no token estimation
- Fork and "Create Agent from Session" are the same operation but presented as two separate UIs

## Design: Unified ContextPicker Dialog

Merge fork + create-agent into a single powerful **ContextPicker** component used for both workflows.

### Two Modes

| Mode | Trigger | Right Panel | Action Button | Backend |
|------|---------|-------------|---------------|---------|
| **Fork Session** | "Fork" button in SessionHeader | Fork prompt + model + machine override | "Fork Session" | `POST /sessions/:id/fork` |
| **Create Agent** | "Create Agent" button in SessionHeader | Agent name + type + model + system prompt | "Create Agent" | `POST /agents` + `POST /sessions` |

The **left panel** (context picker) is identical in both modes.

### Left Panel: Context Picker

```
┌─────────────────────────────────────────────────────────┐
│ ┌─ Toolbar ──────────────────────────────────────────┐  │
│ │ [🔍 Search messages...]  [Filter: All ▾]           │  │
│ │ [Select All] [Deselect All] [Select to here ▾]     │  │
│ │ 847 messages │ 234 selected │ ~48.2k tokens        │  │
│ └────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌─ Message List (virtualized scroll) ────────────────┐  │
│ │ ☑ [user]    Fix the login bug              14:10   │  │
│ │ ☑ [asst]    I'll look at auth.ts...        14:10   │  │
│ │ ☐ [tool]    Read auth.ts                   14:11   │  │ ← dimmed
│ │ ☐ [result]  contents of auth.ts...         14:11   │  │ ← dimmed
│ │ ☑ [asst]    Found the issue, fixing...     14:12   │  │
│ │ ─── Fork point marker ──── [✂ Fork here] ─────── │  │
│ │ ☐ [user]    Wrong approach                 14:15   │  │ ← after fork
│ │ ☐ [asst]    Let me try another way...      14:15   │  │ ← after fork
│ └────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌─ Context Summary ──────────────────────────────────┐  │
│ │ 234 messages │ ~48.2k tokens │ ~$0.048 est.        │  │
│ │ [▼ Auto-compress: Summarize tool results]           │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### Key Features

**1. Virtualized Scroll (no 200 limit)**
- Use `@tanstack/react-virtual` for windowed rendering
- Load all messages from API (already paginated with offset/limit)
- Smooth scrolling even with 1000+ messages

**2. Search & Filter**
- Text search across message content (highlight matches)
- Filter dropdown: All / User only / Assistant only / Tool calls / Tool results / Thinking
- Search + filter combine (AND logic)

**3. Selection Tools**
- **Select All / Deselect All** (existing)
- **Fork Here** button on each message row → selects all messages up to and including that point, deselects everything after (timeline fork)
- **Select Range** — shift+click to select a contiguous range
- **Invert Selection**

**4. Token Estimation**
- Approximate token count: `chars / 3.5` (rough estimate for English/Chinese mixed)
- Show in footer: "234 messages | ~48.2k tokens | ~$0.048 est."
- Color-code: green (<50k), yellow (50k-100k), red (>100k)

**5. Context Compression Tools**
- **Collapse tool pairs**: Tool call + result → single summary line (saves ~70% of tool context)
- **Summarize thinking**: Replace thinking blocks with "[Thinking: N chars]"
- **Truncate long results**: Tool results > 500 chars → first 200 + "...[truncated]"
- These are toggle buttons in the footer, applied before submission

### Right Panel: Mode-Specific Config

**Fork Mode:**
```
┌───────────────────────────┐
│ Fork Prompt               │
│ ┌───────────────────────┐ │
│ │ Try a different        │ │
│ │ approach using...      │ │
│ └───────────────────────┘ │
│                           │
│ Model: [Claude Opus 4.6▾] │
│ Machine: [(same) ▾]       │
│ Account: [(same) ▾]       │
│                           │
│ ── Fork Strategy ──       │
│ ○ JSONL truncation        │
│   (perfect fidelity)      │
│ ○ Context injection       │
│   (cherry-pick)           │
│ ○ Auto (recommended)      │
│                           │
│ ── Source ──               │
│ Session: abc123...        │
│ Agent: my-agent           │
│ Parent Claude ID: xyz...  │
└───────────────────────────┘
```

**Create Agent Mode:**
```
┌───────────────────────────┐
│ Agent Name: [agent-fork]  │
│ Agent Type: [Ad-hoc ▾]    │
│ Model: [Claude Opus 4.6▾] │
│ System Prompt:            │
│ ┌───────────────────────┐ │
│ │ Additional instruct... │ │
│ └───────────────────────┘ │
│                           │
│ ── Source ──               │
│ Session: abc123...        │
│ Agent: my-agent           │
└───────────────────────────┘
```

### Fork Strategy (Auto-select)

| User Action | Strategy | Why |
|-------------|----------|-----|
| "Fork here" (contiguous from start) | **JSONL truncation** | Perfect fidelity — Claude resumes real conversation state |
| Cherry-pick (non-contiguous) | **System prompt injection** | Can't truncate JSONL for scattered messages |
| Select all + new prompt | **CLI --resume** (current) | No truncation needed, existing behavior |

The "Auto" option picks the right strategy based on selection pattern.

### Technical: JSONL Truncation Fork

**New worker endpoint:** `POST /api/sessions/:sessionId/fork-at`

```typescript
type ForkAtBody = {
  prompt: string;
  /** Index of the last message to include (0-based). Everything after is discarded. */
  forkAtIndex: number;
  /** Target session ID for the new forked session. */
  newSessionId: string;
  model?: string;
  accountCredential?: string;
  accountProvider?: string;
};
```

**Implementation:**
1. Find JSONL file: `findSessionJsonl(claudeSessionId)`
2. Read and parse lines, counting user-visible messages
3. Create new JSONL file: `<newSessionId>.jsonl` with lines up to `forkAtIndex`
4. Write to same `.claude/projects/` directory
5. Start new Claude CLI process with `--resume <newSessionId>`

**Safety:**
- Original JSONL is never modified (we create a copy)
- New file uses new session UUID → no collision
- If fork fails, cleanup the new JSONL file

### Technical: System Prompt Injection Fork

For cherry-picked (non-contiguous) messages:

```typescript
function formatContextForInjection(messages: SelectedMessage[]): string {
  const lines: string[] = [
    '## Previous Conversation Context',
    '',
    'The following is a selected excerpt from a prior conversation.',
    'Continue from this context.',
    '',
  ];

  for (const msg of messages) {
    const role = msg.type === 'user' ? 'User' : msg.type === 'assistant' ? 'Assistant' : 'Tool';
    lines.push(`### ${role} (${msg.timestamp})`);
    if (msg.toolName) lines.push(`Tool: ${msg.toolName}`);
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}
```

Pass via `--append-system-prompt` flag (already supported in cli-session-manager).

### API Changes

**Control Plane: `POST /sessions/:id/fork` (enhanced)**

```typescript
type ForkBody = {
  prompt: string;
  machineId?: string;
  accountId?: string;
  model?: string;
  // NEW fields:
  strategy?: 'jsonl-truncation' | 'context-injection' | 'resume'; // default: 'resume'
  forkAtIndex?: number;           // for jsonl-truncation
  selectedMessageIds?: number[];  // for context-injection
  selectedMessages?: Array<{      // pre-formatted messages for injection
    type: string;
    content: string;
    toolName?: string;
    timestamp?: string;
  }>;
};
```

**Web API client: `api.forkSession()` (enhanced)**

```typescript
forkSession: (id: string, body: {
  prompt: string;
  strategy?: 'jsonl-truncation' | 'context-injection' | 'resume';
  forkAtIndex?: number;
  selectedMessages?: SelectedMessage[];
  model?: string;
}) => request<ForkResponse>(`/api/sessions/${id}/fork`, {
  method: 'POST',
  body: JSON.stringify(body),
});
```

### Component Architecture

```
ContextPickerDialog (unified)
├── ContextPickerToolbar        (search, filters, bulk actions)
├── VirtualizedMessageList      (windowed scroll, checkboxes, fork-here buttons)
│   └── ContextMessageRow       (single message with selection + fork-here)
├── ContextSummaryBar           (token count, cost est, compression toggles)
└── ContextPickerSidebar        (mode-dependent: fork config OR agent config)
    ├── ForkConfigPanel         (prompt, model, machine, strategy)
    └── AgentConfigPanel        (name, type, model, system prompt) [existing]
```

### Migration Path

1. Rename `ForkContextPicker` → `ContextPickerDialog`
2. Add `mode: 'fork' | 'create-agent'` prop
3. Implement virtualized list (replace current map)
4. Add search/filter toolbar
5. Add "Fork here" buttons on each row
6. Add token estimation in footer
7. Add compression toggles
8. Connect fork mode to enhanced API
9. Remove old simple fork input from SessionHeader
10. Both "Fork" and "Create Agent" buttons open the same dialog in different modes

### Message Loading

Current: loads 200 messages max.
New: paginated loading with "Load more" or auto-load on scroll.

```typescript
// Load all messages for context picker
const allMessages = await api.getSessionContent(sessionId, {
  machineId,
  projectPath,
  limit: 0, // 0 = all messages (need to add this to API)
});
```

Or progressive loading: start with latest 200, load more chunks on scroll up.
