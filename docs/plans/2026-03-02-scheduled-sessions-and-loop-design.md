# Design: Scheduled Sessions & Continuous Loop

> Date: 2026-03-02
> Status: Approved

## Problem

AgentCTL currently supports agent-level scheduling (cron/heartbeat triggers via BullMQ), but lacks two session-level capabilities:

1. **Scheduled sessions** — run sessions on a cron schedule with the option to resume an existing session or start fresh each time.
2. **Continuous loop** (Ralph Loop) — a session that automatically re-triggers itself after completion, forming an indefinite work loop.

Both require configurable modes, prompt strategies, and safety limits.

## Data Model

```typescript
// packages/shared/src/types/agent.ts

export type AgentType = 'heartbeat' | 'cron' | 'manual' | 'adhoc' | 'loop';
export type SessionMode = 'fresh' | 'resume';
export type LoopMode = 'result-feedback' | 'fixed-prompt' | 'callback';

export type LoopConfig = {
  enabled: boolean;
  mode: LoopMode;
  maxIterations: number | null;    // at least one of these three must be set
  costLimitUsd: number | null;
  maxDurationMs: number | null;    // wall-clock time limit
  iterationDelayMs: number;        // default 1000, min 500
  callbackUrl: string | null;      // for 'callback' mode only
  checkpointEvery: number;         // default 5
};

export type ScheduleConfig = {
  pattern: string;                 // cron expression or interval in ms
  sessionMode: SessionMode;        // 'fresh' = new session, 'resume' = continue last
  promptTemplate: string;          // supports {{date}}, {{iteration}}, {{lastResult}}
};
```

**Validation rules:**
- Loop: at least ONE of maxIterations, costLimitUsd, maxDurationMs must be non-null
- Loop: iterationDelayMs >= 500
- Schedule: if sessionMode === 'resume', agent must have a currentSessionId
- Callback: callbackUrl required when mode === 'callback'

## Approach

**Scheduled sessions**: Extend existing BullMQ RepeatableJobManager. Add sessionMode to AgentTaskJobData.

**Continuous loop**: Hybrid approach. New LoopController runs locally on agent-worker. Checkpoints to control plane periodically.

## LoopController (Agent Worker)

New file: packages/agent-worker/src/runtime/loop-controller.ts

**Flow:**
1. Worker receives job with loopConfig.enabled = true
2. Creates LoopController wrapping AgentInstance
3. Calls agent.start(prompt)
4. On completion: check limits -> build next prompt -> agent.start() again
5. Between iterations: pause iterationDelayMs, checkpoint if due
6. Loop ends when: limit hit, explicit stop, callback returns { stop: true }, or dead-loop detected

**Next prompt by mode:**
- result-feedback: feed result summary back as next prompt
- fixed-prompt: re-use original promptTemplate with variable substitution
- callback: POST callbackUrl { iteration, lastResult, costSoFar } -> { prompt, stop? }

## API Endpoints

```
PUT  /api/agents/:id/schedule       - set/update schedule config
DEL  /api/agents/:id/schedule       - remove schedule
PUT  /api/agents/:id/loop           - set/update loop config
DEL  /api/agents/:id/loop           - disable loop
POST /api/agents/:id/loop/stop      - gracefully stop running loop
GET  /api/agents/:id/loop/status    - current iteration, cost, duration
```

## DB Schema

```sql
ALTER TABLE agents ADD COLUMN loop_config jsonb DEFAULT NULL;
ALTER TABLE agents ADD COLUMN schedule_config jsonb DEFAULT NULL;
ALTER TABLE agent_runs ADD COLUMN loop_iteration integer DEFAULT NULL;
ALTER TABLE agent_runs ADD COLUMN parent_run_id uuid DEFAULT NULL;
```

## Safety

| Mechanism | Description |
|-----------|-------------|
| Triple limit | maxIterations + costLimitUsd + maxDurationMs (at least one required) |
| Min delay | iterationDelayMs >= 500ms enforced server-side |
| Emergency stop | POST /api/agents/:id/loop/stop + abort signal |
| Checkpoint | Every N iterations, worker POSTs status to control plane |
| Cost alert | Warning event at 80% of costLimitUsd |
| Dead-loop detection | Warn/stop after 3 identical results (content hash) |
| Network partition | Auto-pause if checkpoint fails 3x consecutively |
