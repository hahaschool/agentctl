# Codex Config Capabilities Exposure

**Date**: 2026-03-14
**Status**: Draft
**Scope**: Sub-project B of Codex Runtime Parity — expose backend Codex-specific configuration to the UI

## Problem

The backend supports Codex-specific configuration (sandbox level, approval policy, reasoning effort, model provider) via `ManagedRuntimeConfig` and `runtimeOverrides.codex`. But agent settings UI has no way to set these. Users must edit raw config or rely on fleet-wide defaults.

**Data model reality**: These fields live on `ManagedRuntimeConfig` (fleet-wide defaults managed via `PUT /api/runtime-config/defaults`), NOT on `AgentConfig` (per-agent). To enable per-agent overrides, we need to extend `AgentConfig` with override fields that the session launcher merges with fleet-wide defaults at session start time.

## Goals

1. New "Runtime Config" tab in agent settings for per-agent runtime configuration overrides
2. Per-agent overrides that merge with fleet-wide `ManagedRuntimeConfig` defaults at session start
3. Codex-specific fields (reasoning effort, model provider) only show when agent runtime is `codex`
4. Read-only config preview showing the rendered config file

## Non-Goals

- Editing fleet-wide `ManagedRuntimeConfig` defaults (already available via Runtime Settings page)
- `instructions` and `environmentPolicy` fields (already covered by Model & Prompts tab and out of scope)
- Mobile UI for these settings

## Data Model

### Per-Agent Runtime Config Overrides

Extend `AgentConfig` in `packages/shared/src/types/agent.ts`:

```typescript
type AgentRuntimeConfigOverrides = {
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  codexReasoningEffort?: 'low' | 'medium' | 'high';
  codexModelProvider?: 'openai' | 'azure';
};

type AgentConfig = {
  // ... existing fields
  runtimeConfigOverrides?: AgentRuntimeConfigOverrides;
};
```

Fields are optional — `undefined` means "use fleet-wide default." This is a JSONB column extension, no database migration needed.

### Session Start Resolution

At session creation, the worker merges:
```
effective = { ...fleetDefaults, ...agent.config.runtimeConfigOverrides }
```

Modify `packages/agent-worker/src/runtime/config/` renderers to check agent-level overrides before using fleet defaults.

### Excluded Fields

- `executionEnvironment` (direct/docker): per-session field on `ManagedSession`, not suitable for per-agent defaults — set at session creation time via the existing session form.
- `handoffStrategy`: per-handoff field, not a persistent config.

## Design

### New "Runtime Config" Tab

Add a 7th tab to agent settings at `packages/web/src/app/agents/[id]/settings/page.tsx`. Only visible when `isManagedRuntime(agent.runtime)`.

### Form Fields

All fields use shadcn/ui `Select` components. Each shows the fleet default as placeholder text. Values save to `agent.config.runtimeConfigOverrides` via the existing `updateAgent` mutation.

| Field | Type | Options | Override Path | Visibility |
|-------|------|---------|--------------|-----------|
| Sandbox Level | Select | `read-only`, `workspace-write`, `danger-full-access` | `runtimeConfigOverrides.sandbox` | Both runtimes |
| Approval Policy | Select | `untrusted`, `on-failure`, `on-request`, `never` | `runtimeConfigOverrides.approvalPolicy` | Both runtimes |
| Reasoning Effort | Select | `low`, `medium`, `high` | `runtimeConfigOverrides.codexReasoningEffort` | Codex only |
| Model Provider | Select | `openai`, `azure` | `runtimeConfigOverrides.codexModelProvider` | Codex only |

Each Select includes a "Use fleet default" option (empty value) that clears the override.

### Config Preview Panel

Collapsible section below the form fields showing the rendered config file:
- Claude Code agents: rendered `.claude.json` (JSON)
- Codex agents: rendered `.codex/config.toml` (TOML)

**Implementation**: The config renderers live in `packages/agent-worker/`, not in the control plane. The CP proxies a preview request to the worker: `GET /api/agents/:id/config-preview` → worker `GET /api/config-preview?agentId=...`. The worker runs the renderer in dry-run mode (returns string, doesn't write to disk).

### Error Handling

- Invalid combinations (e.g., `danger-full-access` with restrictive approval): show warning badge but allow save — backend validates at session start
- Agent without runtime set: tab hidden via `isManagedRuntime` guard
- Preview generation failure: show error message in preview panel, don't block saves
- Fleet default display: each field shows "Fleet default: {value}" as helper text below the select

### Testing

**Unit (Vitest):**
- `RuntimeConfigTab`: renders 4 fields, Codex-only fields hidden for claude-code, "Use fleet default" option works
- `ConfigPreview`: renders JSON for claude-code, TOML for codex, loading/error states

**Backend (Vitest):**
- Override merge logic: agent overrides take precedence over fleet defaults
- Config preview endpoint returns rendered config string

## Files

### New Files
- `packages/shared/src/types/agent-runtime-config.ts` — `AgentRuntimeConfigOverrides` type
- `packages/web/src/components/agent-settings/RuntimeConfigTab.tsx`
- `packages/web/src/components/agent-settings/RuntimeConfigTab.test.tsx`
- `packages/web/src/components/agent-settings/ConfigPreview.tsx`
- `packages/agent-worker/src/api/routes/config-preview.ts` — dry-run config render endpoint
- `packages/control-plane/src/api/routes/agent-config-preview.ts` — CP proxy

### Modified Files
- `packages/shared/src/types/agent.ts` — add `runtimeConfigOverrides` to `AgentConfig`
- `packages/agent-worker/src/runtime/config/claude-config-renderer.ts` — merge agent overrides
- `packages/agent-worker/src/runtime/config/codex-config-renderer.ts` — merge agent overrides
- `packages/web/src/app/agents/[id]/settings/page.tsx` — add "Runtime Config" tab
- `packages/web/src/lib/api.ts` — add `getAgentConfigPreview()` method
- `packages/web/src/lib/queries.ts` — add query for config preview + fleet defaults
