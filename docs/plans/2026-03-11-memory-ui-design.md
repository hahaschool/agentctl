# Unified Memory System UI — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Approach:** Full-Stack Vertical (page-by-page, API + UI + test per page)

## Overview

A comprehensive memory management UI for AgentCTL's unified memory system, deeply integrated into the existing agent/session/machine infrastructure. Memory is a first-class citizen — a top-level `/memory` route with 8 sub-pages, plus memory data surfaced contextually across existing pages.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| User persona | Both human curation + agent MCP | Operators curate knowledge; agents access via MCP tools at runtime |
| Scope | All 8 areas | Browser, Graph, Dashboard, Consolidation, Reports, Import, Editor, Scopes |
| Navigation | Top-level `/memory` | Memory is a core platform pillar alongside agents/machines/sessions |
| Internal layout | Left sidebar | Grouped nav (daily use vs tools), maximizes content width, "app within app" |
| Knowledge Graph | Multi-view + detail panel | Toggle Graph/Table/Timeline/Clusters; click node opens persistent detail panel |
| Consolidation | Hybrid dashboard + priority queue | Category metrics at top, unified severity-sorted queue below |
| Reports | All 3 types | Project progress, knowledge health, activity digest — each with scope + time range |
| Implementation | Full-stack vertical | Ship each page end-to-end (API → component → test) in priority order |

## Priority Order

1. Memory Browser (most used daily)
2. Knowledge Graph (visual exploration)
3. Memory Dashboard (health overview)
4. Consolidation Board (knowledge quality)
5. Reports (stakeholder + maintenance)
6. Import Wizard (one-time claude-mem migration)
7. Fact Editor (modal, not standalone page)
8. Scope Manager (hierarchy management)

## Route Structure

```
/memory                    → redirects to /memory/browser
/memory/browser            → Memory Browser
/memory/graph              → Knowledge Graph
/memory/dashboard          → Memory Dashboard
/memory/consolidation      → Consolidation Board
/memory/reports            → Reports
/memory/import             → Import Wizard
/memory/editor/:id?        → Fact Editor (modal accessible from any page)
/memory/scopes             → Scope Manager
```

## Layout

Left sidebar navigation within `/memory`, grouped into two sections:

```
MEMORY (daily use)       TOOLS (occasional)
├── 📋 Browser           ├── 📥 Import
├── 🕸️ Graph            ├── ✏️ Editor
├── 📈 Dashboard         └── 🔧 Scopes
├── ⚖️ Consolidation
└── 📊 Reports
```

Sidebar shows badge counts where relevant (e.g., "Consolidation (7)").

## Shared Components

### New Components

| Component | Purpose |
|-----------|---------|
| `FactCard` | Displays a MemoryFact: content, entity_type badge, confidence bar, scope badge, strength indicator, source info |
| `EntityTypeBadge` | Color-coded badge: pattern=green, decision=amber, error=red, concept=blue, code_artifact=purple, preference=gray, person=teal |
| `ScopeBadge` | Scope with color: global=blue, project=green, agent=orange, session=gray |
| `ConfidenceBar` | Horizontal bar: green >0.8, yellow 0.5-0.8, red <0.5 |
| `StrengthMeter` | Sparkline or bar showing decay over time |
| `MemorySidebar` | Left navigation with active state + badge counts |
| `ScopeSelector` | Dropdown/tree for picking scope (used in search, editor, reports) |
| `FactDetailPanel` | Slide-over panel: full fact details + edges + actions (used in Graph and Browser) |

### Existing Libraries Used

| Library | Usage |
|---------|-------|
| `react-force-graph-2d` | Knowledge Graph visualization (dynamic import, ssr: false) |
| `recharts` | Dashboard charts (line, donut, histogram) |
| `@tanstack/react-virtual` | Virtualized scroll in Browser (already in codebase) |
| `@tanstack/react-table` | Data table in Browser + Graph table view |
| `nuqs` | URL state persistence for shareable filtered views |
| `react-activity-calendar` or custom SVG | GitHub-style activity heatmap |

## Page Designs

### 1. Memory Browser (`/memory/browser`)

The primary daily-use page. Searchable, filterable data table of all facts.

**Layout:** Three-column — filter sidebar (left), results list (center), detail panel (right, on click).

**Search bar:** Unified search with mode toggle: Semantic | Keyword | Hybrid (default). Debounced input, results update live.

**Filter sidebar:**
- Scope: checkbox tree (global, project:*, agent:*)
- Entity type: checkboxes with counts
- Confidence: range slider (0.0 — 1.0)
- Strength: range slider
- Date range: preset (7d/30d/90d/all) + custom
- Source: agent filter, machine filter
- Pinned only toggle

**Results list:**
- FactCard per result, virtualized scroll
- Inline bulk select via shift+click
- Bulk actions bar: delete, re-scope, re-tag, merge
- Pagination or infinite scroll with count indicator

**Detail panel (slide-in on fact click):**
- Full content, editable inline (double-click)
- Entity type, scope, confidence (editable)
- Relationship list with add/remove
- Source provenance: session link, agent link, machine link, timestamp
- Pin toggle, delete button
- "View in Graph" link

**URL state:** All filters persisted in URL via `nuqs` for shareable views.

### 2. Knowledge Graph (`/memory/graph`)

Interactive multi-view visualization of the knowledge graph.

**Four view modes (tab toggle at top):**

1. **Graph view:** react-force-graph-2d canvas
   - Nodes colored by entity type, sized by edge count
   - Edges labeled with relation type on hover
   - Drag to rearrange, scroll to zoom, pinch on mobile
   - Hover node → tooltip (name, type, confidence, edge count)
   - Click node → detail panel opens/updates on right
   - Double-click → focus mode (only this node + 2-hop neighbors)
   - Right-click → context menu (pin, edit, view in browser, show related)
   - Time-lapse button → animate graph growth over selected date range

2. **Table view:** TanStack Table with sortable columns
   - Columns: content, entity_type, scope, confidence, edge_count, created_at
   - Click row → same detail panel
   - Fallback for large datasets where graph is too dense

3. **Timeline view:** Vertical chronological timeline
   - Facts ordered by creation date
   - Each entry shows: entity type icon, content preview, scope badge
   - Bi-temporal toggle: "when it happened" vs "when we learned it"
   - Useful for understanding knowledge evolution

4. **Clusters view:** Auto-detected communities
   - Group facts with many mutual edges into clusters
   - Each cluster shows: AI-generated summary, member count, entity type distribution
   - Click cluster → expand to show individual facts
   - Useful for discovering knowledge themes

**Filter bar (bottom of viewport):**
- Scope selector, entity type multi-select, confidence threshold slider

**Detail panel (right side, persistent):**
- Same as Browser detail panel
- Relationships section shows edge direction arrows
- "Focus in Graph" button to center visualization on this node

### 3. Memory Dashboard (`/memory/dashboard`)

Overview health metrics and activity monitoring.

**Top row — KPI cards:**
- Total facts (with trend arrow)
- New this week
- Average confidence
- Pending consolidation items

**Charts row 1 (2 columns):**
- Knowledge Growth: line chart, facts per day over selected period
- Type Distribution: donut chart, by entity type

**Charts row 2 (2 columns):**
- Scope Coverage: horizontal bar chart, facts per scope
- Strength Decay: histogram of current strength values (active/decaying/archived bands)

**Activity heatmap:**
- GitHub-contribution style, memory operations per day, 52-week view
- Color intensity = operation count

**Recent Activity feed:**
- Last 20 memory events: facts stored, accessed, consolidated, imported
- Each entry: icon, description, agent/session link, relative timestamp

### 4. Consolidation Board (`/memory/consolidation`)

Human-in-the-loop knowledge quality review.

**Top row — category summary cards:**
- Contradictions count (high severity, red)
- Near-duplicates count (medium, amber)
- Stale facts count (low, yellow)
- Orphans count (low, gray)
- Click card to filter queue by category

**Priority queue (main content):**
- Items sorted by severity: contradictions → duplicates → stale → orphans
- Each item is expandable:

**Contradiction item:**
- Side-by-side: Fact A vs Fact B
- Each shows: content, confidence, scope, creation date, source session
- AI suggestion: "Keep A, supersede B" with reason
- Actions: [Accept] [Edit resolution] [Skip] [Delete both]

**Near-duplicate item:**
- Cosine similarity score
- Both facts shown with diff-highlighting of differences
- AI suggestion: "Merge → keep richer version"
- Actions: [Merge] [Keep both] [Skip]

**Stale fact item:**
- Fact content, last accessed date, current strength
- AI suggestion: "Archive" or "Still relevant — boost strength"
- Actions: [Archive] [Boost] [Skip] [Delete]

**Orphan item:**
- Fact with no edges
- AI suggestion: "Link to entity X" or "Delete — low value"
- Actions: [Link to...] [Skip] [Delete]

**Backend:** Consolidation scan runs as a daily cron job or on-demand via "Run scan now" button. Generates `ConsolidationItem` records stored in DB. Items disappear from queue when acted upon.

### 5. Reports (`/memory/reports`)

Scoped knowledge report generation.

**Report generator form:**
- Type: dropdown (Project Progress | Knowledge Health | Activity Digest)
- Scope: ScopeSelector (global, project:X, agent:X)
- Period: preset (today/this week/this month/custom range)
- Format: Markdown (default), JSON
- [Generate Report] button

**Report types:**

1. **Project Progress:** LLM-generated natural language summary. Sections: New Knowledge, Decisions Made, Patterns Discovered, Errors Encountered, Key Entities. Grouped by entity type. Designed for stakeholder communication.

2. **Knowledge Health:** Charts + tables. Fact growth trend, confidence distribution, coverage gaps (scopes with few facts), decay rate, orphan ratio, consolidation history. Designed for maintenance.

3. **Activity Digest:** Timeline of memory operations. Which agents stored/accessed what facts, which sessions produced the most knowledge, consolidation actions taken. Designed for debugging.

**Recent reports list:**
- Previously generated reports with title, scope, period, generation date
- Actions: View (rendered inline as Markdown), Download .md, Copy to clipboard

### 6. Import Wizard (`/memory/import`)

One-time claude-mem migration, 4-step wizard.

**Step 1: Source Selection**
- Detect claude-mem SQLite path (default `~/.claude-mem/claude-mem.db`)
- Show discovered stats: observation count, project count, date range
- Browse button for custom path
- Future: JSONL history import (disabled/grayed)

**Step 2: Preview & Mapping**
- Sample 10 rows from source, show side-by-side: original fields → mapped MemoryFact fields
- Type mapping table: user can override (e.g., `bugfix` → `error`, `feature` → `code_artifact`)
- Scope mapping: project name → `project:X` scope
- Confidence rules preview: well-documented=0.95, structured=0.90, title-only=0.80, sparse=0.60

**Step 3: Import Progress**
- Progress bar (current / total)
- Live log: imported (green), skipped as duplicate (yellow), errored (red)
- Dedup via embedding cosine similarity > 0.92
- Cancel button (stops import, keeps already-imported facts)

**Step 4: Summary**
- Final counts: X imported, Y skipped, Z errors
- Links: "View imported facts in Browser", "View in Knowledge Graph"
- Rollback button: `DELETE FROM memory_facts WHERE source_json->>'source' = 'claude-mem'`

### 7. Fact Editor (Modal)

Not a standalone page — a sheet/modal accessible from:
- Browser: click edit on FactCard or detail panel
- Graph: click edit in detail panel
- New Fact button: opens empty editor
- Command palette: `memory:create`

**Fields:**
- Content (textarea, required)
- Entity type (dropdown)
- Scope (ScopeSelector)
- Confidence (slider 0.0-1.0)
- Pinned toggle (always-inject into agent context)
- Relationships: list with add/remove, each has: direction (→ ←), relation type, target fact (searchable select)

**Source info (read-only for existing facts):**
- Session, agent, machine, timestamp, extraction method

### 8. Scope Manager (`/memory/scopes`)

Scope hierarchy management.

**Scope tree:**
- Expandable tree: global → project:X → agent:X / session:X
- Each node shows fact count
- Click node → actions panel

**Actions:**
- View facts (→ Browser filtered to this scope)
- Promote facts (bulk move child → parent scope)
- Merge scopes (combine two scopes, redirect all facts)
- Rename scope
- Delete scope (must be empty or confirm cascade)
- Create child scope

## Integration Points

Memory data surfaced contextually across existing pages:

### Session Detail Page (`/sessions/:id`)
- New "Memory" tab: facts read, created, and updated during this session
- "What did the agent learn?" auto-summary
- Click fact → FactDetailPanel

### Agent Detail Page (`/agents/:id`)
- Memory usage section: facts created, read count, scope distribution
- Mini knowledge graph showing this agent's knowledge footprint
- "View in Knowledge Graph" → `/memory/graph?agent=agent-1`

### Runtime Sessions (`/runtime-sessions`)
- Memory injection status: which facts were injected at session start
- Token budget usage: "142 facts injected (2,847 / 4,096 tokens)"

### Machine Page (`/machines/:id`)
- Per-machine memory stats: facts originating from this machine
- Cross-machine memory sync status

### Main Dashboard (`/`)
- Memory health card: total facts, growth trend, pending consolidation
- "Recent Knowledge" widget: last 5 facts learned

### Context Picker Dialog (fork dialog)
- Replace current MemoryPanel (claude-mem) with unified memory search
- Facts selectable for fork context injection with token estimation

### Command Palette
- `memory:search <query>` — quick search from anywhere
- `memory:create` — quick fact creation
- `memory:graph <entity>` — jump to graph focused on entity

### Session Creation Form
- Scope selector: which memory scopes to inject
- Memory budget override: adjust token budget

## Backend API

### New Routes (`/api/memory/*`)

```
GET    /api/memory/facts              List/search facts (hybrid search)
POST   /api/memory/facts              Create fact
GET    /api/memory/facts/:id          Get single fact + edges
PATCH  /api/memory/facts/:id          Update fact
DELETE /api/memory/facts/:id          Soft-delete (invalidate)

GET    /api/memory/edges              List edges (filter by source/target)
POST   /api/memory/edges              Create edge
DELETE /api/memory/edges/:id          Remove edge

GET    /api/memory/graph              Graph data (nodes + edges for viz)

GET    /api/memory/scopes             List scope hierarchy
POST   /api/memory/scopes             Create scope

GET    /api/memory/consolidation      Get review queue
POST   /api/memory/consolidation/:id/action  Apply action

POST   /api/memory/reports            Generate report
GET    /api/memory/reports/:id        Get generated report

POST   /api/memory/import             Trigger claude-mem import
GET    /api/memory/import/status      Import progress

GET    /api/memory/stats              Dashboard metrics
```

### Cross-entity Query Extensions

```
GET /api/memory/facts?sessionId=X     Facts from a session
GET /api/memory/facts?agentId=X       Facts by an agent
GET /api/memory/facts?machineId=X     Facts from a machine
GET /api/memory/injection-preview     Preview injection for a session config
```

### MCP Tools (agent runtime access)

| Tool | Purpose |
|------|---------|
| `memory_search` | Hybrid search (vector + BM25 + graph), returns ranked facts |
| `memory_store` | Store a new fact with scope + entity_type |
| `memory_recall` | Graph traversal from an entity (2-hop BFS) |
| `memory_feedback` | Signal relevance (used / irrelevant / outdated) |
| `memory_report` | Generate scoped report |
| `memory_promote` | Escalate fact to parent scope |

## Tech Stack

| Component | Library |
|-----------|---------|
| Graph visualization | `react-force-graph-2d` (dynamic import, ssr: false) |
| Data tables | `@tanstack/react-table` + shadcn DataTable |
| Charts | `recharts` |
| Virtualized lists | `@tanstack/react-virtual` (already in codebase) |
| URL state | `nuqs` |
| Activity heatmap | `react-activity-calendar` or custom SVG |
| Search | Custom hybrid (cmdk integration + faceted filters) |

## Data Model

Uses existing `MemoryFact`, `MemoryEdge`, `MemoryScope` types from `@agentctl/shared`. No schema changes needed — the `0010_add_memory_layer.sql` migration already covers all required tables and indexes.

### New Types Needed

```typescript
type ConsolidationItem = {
  id: string;
  type: 'contradiction' | 'near-duplicate' | 'stale' | 'orphan';
  severity: 'high' | 'medium' | 'low';
  factIds: string[];
  suggestion: string;
  reason: string;
  status: 'pending' | 'accepted' | 'skipped';
  createdAt: string;
};

type MemoryReport = {
  id: string;
  type: 'project-progress' | 'knowledge-health' | 'activity-digest';
  scope: string;
  periodStart: string;
  periodEnd: string;
  content: string;        // Rendered markdown
  metadata: {
    factCount: number;
    newFacts: number;
    topEntities: string[];
  };
  generatedAt: string;
};

type ImportJob = {
  id: string;
  source: 'claude-mem' | 'jsonl-history';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: { current: number; total: number };
  imported: number;
  skipped: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
};

type MemoryStats = {
  totalFacts: number;
  newThisWeek: number;
  avgConfidence: number;
  pendingConsolidation: number;
  byScope: Record<string, number>;
  byEntityType: Record<string, number>;
  strengthDistribution: { active: number; decaying: number; archived: number };
  growthTrend: Array<{ date: string; count: number }>;
};
```
