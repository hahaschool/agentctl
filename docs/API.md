# AgentCTL Control Plane — REST API Reference

Base URL: `http://<host>:8080` (beta) | `http://<host>:8180` (dev-1)

All request bodies use `Content-Type: application/json`. All responses return JSON unless noted otherwise.

---

## Table of Contents

1. [Health](#1-health)
2. [Agents](#2-agents)
3. [Machines](#3-machines)
4. [Sessions](#4-sessions)
5. [Runs](#5-runs)
6. [Tasks](#6-tasks)
7. [Memory](#7-memory)
8. [Spaces & Collaboration](#8-spaces--collaboration)
9. [Approvals & Permissions](#9-approvals--permissions)
10. [Settings & Accounts](#10-settings--accounts)
11. [Discovery & Skills](#11-discovery--skills)
12. [Deployment](#12-deployment)
13. [Router (LiteLLM)](#13-router-litellm)
14. [Agent Profiles](#14-agent-profiles)
15. [Notifications](#15-notifications)
16. [Error Format](#16-error-format)

---

## 1. Health

### GET /health

Returns system health status and process metrics.

**Query Parameters**

| Parameter | Type   | Description                                      |
|-----------|--------|--------------------------------------------------|
| `detail`  | string | Pass `true` to include per-dependency breakdown  |

**Response 200**

```json
{
  "status": "ok",
  "timestamp": "2026-03-19T10:00:00.000Z",
  "uptime": 3600,
  "nodeVersion": "v20.11.0",
  "memoryUsage": {
    "rss": 128.5,
    "heapUsed": 64.2,
    "heapTotal": 96.0
  }
}
```

With `?detail=true`:

```json
{
  "status": "ok",
  "timestamp": "2026-03-19T10:00:00.000Z",
  "uptime": 3600,
  "nodeVersion": "v20.11.0",
  "memoryUsage": { "rss": 128.5, "heapUsed": 64.2, "heapTotal": 96.0 },
  "dependencies": {
    "postgres": { "status": "ok", "latencyMs": 3 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "mem0": { "status": "ok", "latencyMs": 12 },
    "litellm": { "status": "ok", "latencyMs": 8 }
  }
}
```

**Status values**: `"ok"` | `"degraded"`

---

### GET /metrics

Returns Prometheus-format metrics for scraping.

**Response 200** (`Content-Type: text/plain; version=0.0.4`)

```
# HELP agentctl_control_plane_up Control plane is up
# TYPE agentctl_control_plane_up gauge
agentctl_control_plane_up 1
# HELP agentctl_agents_total Total registered agents
agentctl_agents_total 5
# HELP agentctl_agents_active Currently running agents
agentctl_agents_active 2
# HELP agentctl_runs_total Total runs dispatched
agentctl_runs_total 142
# HELP agentctl_http_requests_total Total HTTP requests
agentctl_http_requests_total{method="GET",path="/health",status="200"} 1402
# HELP agentctl_dependency_healthy Dependency health status (1=healthy, 0=unhealthy)
agentctl_dependency_healthy{name="postgres"} 1
```

---

## 2. Agents

Agents are the primary execution units. Mounted at `/api/agents`.

### POST /api/agents

Create a new agent.

**Request Body**

| Field           | Type    | Required | Description                                          |
|-----------------|---------|----------|------------------------------------------------------|
| `machineId`     | string  | Yes      | ID of the machine that will run this agent           |
| `name`          | string  | Yes      | Human-readable agent name                            |
| `type`          | string  | Yes      | Agent type (e.g. `"adhoc"`, `"cron"`)                |
| `runtime`       | string  | No       | Runtime type (e.g. `"claude-code"`, `"codex"`)       |
| `schedule`      | string  | No       | Cron expression for scheduled agents                 |
| `projectPath`   | string  | No       | Absolute path to the project directory               |
| `worktreeBranch`| string  | No       | Git worktree branch name                             |
| `config`        | object  | No       | Agent-specific config (model, allowedTools, etc.)    |

```json
POST /api/agents
{
  "machineId": "mac-mini-01",
  "name": "auth-agent",
  "type": "adhoc",
  "runtime": "claude-code",
  "config": { "model": "claude-opus-4-5", "allowedTools": ["Read", "Write", "Bash"] }
}
```

**Response 200**

```json
{ "ok": true, "agentId": "d4e5f6a7-..." }
```

**Error Codes**: `INVALID_BODY` (400) | `INVALID_RUNTIME` (400) | `DATABASE_NOT_CONFIGURED` (501)

---

### GET /api/agents/list

List agents with pagination.

**Query Parameters**

| Parameter   | Type   | Default | Description                              |
|-------------|--------|---------|------------------------------------------|
| `machineId` | string | —       | Filter by machine                         |
| `limit`     | number | 20      | Page size (max 100)                       |
| `offset`    | number | 0       | Pagination offset                         |

**Response 200**

```json
{
  "agents": [
    {
      "id": "d4e5f6a7-...",
      "name": "auth-agent",
      "machineId": "mac-mini-01",
      "type": "adhoc",
      "status": "idle",
      "totalCostUsd": 1.24,
      "lastCostUsd": 0.15,
      "createdAt": "2026-03-19T10:00:00.000Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Error Codes**: `INVALID_PARAMS` (400) | `DATABASE_NOT_CONFIGURED` (501)

---

### GET /api/agents/:agentId

Get a single agent by ID.

```
GET /api/agents/d4e5f6a7-...
```

**Response 200** — Full agent record (same shape as list items, plus `config`, `currentSessionId`, etc.)

**Error Codes**: `AGENT_NOT_FOUND` (404) | `DATABASE_NOT_CONFIGURED` (501)

---

### PATCH /api/agents/:agentId

Update agent fields.

**Request Body** (all fields optional)

| Field       | Type          | Description                                  |
|-------------|---------------|----------------------------------------------|
| `accountId` | string\|null  | API account to use (null to clear)           |
| `name`      | string        | New name (max 256 chars)                      |
| `machineId` | string        | Reassign to a different machine               |
| `type`      | string        | Change agent type                             |
| `schedule`  | string\|null  | Cron schedule (null to clear)                 |
| `config`    | object        | Replace agent config                          |

**Response 200** — Updated agent record

**Error Codes**: `INVALID_*` (400) | `AGENT_NOT_FOUND` (404) | `DATABASE_NOT_CONFIGURED` (501)

---

### PATCH /api/agents/:agentId/status

Update agent status.

**Request Body**

| Field    | Type   | Required | Description                                                                              |
|----------|--------|----------|------------------------------------------------------------------------------------------|
| `status` | string | Yes      | One of: `idle`, `running`, `paused`, `error`, `stopped`                                 |

**Response 200** — `{ "ok": true }`

**Error Codes**: `INVALID_STATUS` (400) | `AGENT_NOT_FOUND` (404)

---

### POST /api/agents/:id/start

Enqueue an agent task run via BullMQ.

**Request Body**

| Field           | Type     | Description                                          |
|-----------------|----------|------------------------------------------------------|
| `prompt`        | string   | Initial prompt (max 32,000 chars)                    |
| `model`         | string   | Model override                                       |
| `allowedTools`  | string[] | Tool allow-list override                             |
| `resumeSession` | string   | Claude session ID to resume                          |
| `machineId`     | string   | Machine to run on (only needed for auto-create flow) |

```json
POST /api/agents/d4e5f6a7-.../start
{
  "prompt": "Fix the authentication bug in src/auth.ts",
  "model": "claude-sonnet-4-6"
}
```

**Response 200**

```json
{ "ok": true, "agentId": "d4e5f6a7-...", "jobId": "bq-123", "prompt": "Fix...", "model": "claude-sonnet-4-6" }
```

**Error Codes**: `PROMPT_TOO_LONG` (400) | `NO_MACHINES_AVAILABLE` (503)

---

### POST /api/agents/:id/stop

Stop an agent (removes repeatable BullMQ jobs).

**Request Body**

| Field      | Type    | Description             |
|------------|---------|-------------------------|
| `reason`   | string  | Stop reason             |
| `graceful` | boolean | Graceful shutdown flag  |

**Response 200** — `{ "ok": true, "agentId": "...", "removedRepeatableJobs": 1 }`

---

### POST /api/agents/:id/steer

Inject a steering message into a running agent session (proxied to the worker).

**Query Parameters**

| Parameter   | Type   | Description                      |
|-------------|--------|----------------------------------|
| `workerUrl` | string | Override worker URL (optional)   |
| `machineId` | string | Machine hint (optional)          |

**Request Body**

| Field     | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| `message` | string | Yes      | Steering message (max 32,000 chars)  |

**Response 200** — Proxied worker response

**Error Codes**: `INVALID_STEER_MESSAGE` (400) | `STEER_MESSAGE_TOO_LONG` (400) | `MACHINE_NOT_FOUND` / `MACHINE_OFFLINE` (503/404)

---

### POST /api/agents/:id/signal

Queue a signal-triggered agent run.

**Request Body**

| Field      | Type   | Required | Description                     |
|------------|--------|----------|---------------------------------|
| `prompt`   | string | Yes      | Prompt for the triggered run    |
| `metadata` | object | No       | Arbitrary signal metadata       |

**Response 200**

```json
{ "ok": true, "agentId": "...", "jobId": "bq-456" }
```

**Error Codes**: `INVALID_SIGNAL_BODY` (400) | `AGENT_NOT_FOUND` (404) | `DATABASE_NOT_CONFIGURED` / `QUEUE_NOT_CONFIGURED` (501)

---

### POST /api/agents/:id/safety-decision

Apply a workdir safety decision to a pending agent run (proxied to worker).

**Request Body**

| Field      | Type   | Required | Description                          |
|------------|--------|----------|--------------------------------------|
| `decision` | string | Yes      | One of: `approve`, `deny`, `skip`   |

**Response 200** — Proxied worker response

**Error Codes**: `INVALID_SAFETY_DECISION` (400)

---

### POST /api/agents/:id/complete

Run completion callback — called by the agent worker when a run finishes.

**Request Body**

| Field           | Type              | Required | Description                                               |
|-----------------|-------------------|----------|-----------------------------------------------------------|
| `runId`         | string            | Yes      | BullMQ job / run ID                                       |
| `status`        | string            | No*      | `"success"`, `"failure"`, or `"empty"` (*one of `status`/`phase` required) |
| `phase`         | string            | No*      | Run phase (`queued`, `dispatching`, `running`, `completed`, etc.) |
| `errorMessage`  | string            | No       | Error description on failure                              |
| `costUsd`       | number            | No       | Total cost in USD                                         |
| `tokensIn`      | number            | No       | Input tokens consumed                                     |
| `tokensOut`     | number            | No       | Output tokens generated                                   |
| `durationMs`    | number            | No       | Total run duration in milliseconds                        |
| `sessionId`     | string            | No       | Claude session ID generated by this run                   |
| `resultSummary` | object            | No       | Structured execution summary (includes `prUrl`, `executiveSummary`, etc.) |

**Response 200**

```json
{ "ok": true, "runId": "bq-123", "status": "success", "phase": "completed" }
```

**Error Codes**: `INVALID_RUN_ID` (400) | `INVALID_STATUS` (400) | `RUN_NOT_FOUND` (404) | `DATABASE_NOT_CONFIGURED` (501)

---

### GET /api/agents/:agentId/runs

Recent runs for an agent.

**Query Parameters**

| Parameter | Type   | Default | Description            |
|-----------|--------|---------|------------------------|
| `limit`   | number | 20      | Max runs to return     |

**Response 200** — Array of run records

**Error Codes**: `DATABASE_NOT_CONFIGURED` (501)

---

### GET /api/agents/:agentId/health

Agent health metrics (consecutive failures, failure rate).

**Query Parameters**

| Parameter | Type   | Default | Description                   |
|-----------|--------|---------|-------------------------------|
| `limit`   | number | 10      | Runs to include in window (max 100) |

**Response 200**

```json
{
  "consecutiveFailures": 2,
  "failureRate24h": 0.25,
  "lastSuccessAt": "2026-03-19T09:30:00.000Z"
}
```

**Error Codes**: `INVALID_PARAMS` (400) | `AGENT_NOT_FOUND` (404) | `DATABASE_NOT_CONFIGURED` (501)

---

## 3. Machines

Machines are worker nodes that run agents. These routes are also exposed at `/api/machines` and `/api/agents` (the agents plugin registers both machine and agent routes).

### POST /register

Register a machine with the control plane (called by agent-worker on startup).

**Request Body**

| Field       | Type   | Required | Description                  |
|-------------|--------|----------|------------------------------|
| `machineId` | string | Yes      | Unique machine identifier    |
| `hostname`  | string | Yes      | Machine hostname              |
| `...`       | object | No       | Additional capabilities       |

**Response 200**

```json
{ "ok": true, "machineId": "mac-mini-01" }
```

**Error Codes**: `INVALID_MACHINE_ID` (400) | `INVALID_HOSTNAME` (400)

---

### POST /:id/heartbeat

Machine heartbeat — keeps the machine registration alive.

**Request Body**

| Field          | Type   | Description              |
|----------------|--------|--------------------------|
| `capabilities` | object | Updated capability set   |

**Response 200** — `{ "ok": true }`

---

### GET /api/machines

List all registered machines.

**Response 200** — Array of machine records (id, hostname, status, tailscaleIp, capabilities, lastSeen, etc.)

```json
[
  {
    "id": "mac-mini-01",
    "hostname": "mac-mini.local",
    "status": "online",
    "tailscaleIp": "100.64.0.5",
    "lastSeen": "2026-03-19T10:00:00.000Z"
  }
]
```

---

## 4. Sessions

Remote Control (RC) sessions represent Claude Code CLI instances. Mounted at `/api/sessions`.

### GET /api/sessions/discover

Fan-out session discovery across all online workers.

**Query Parameters**

| Parameter     | Type   | Description                                 |
|---------------|--------|---------------------------------------------|
| `projectPath` | string | Filter sessions by project path (optional)  |

**Response 200**

```json
{
  "sessions": [
    {
      "sessionId": "sess-abc",
      "projectPath": "/home/user/project",
      "lastActivity": "2026-03-19T10:00:00.000Z",
      "machineId": "mac-mini-01",
      "hostname": "mac-mini.local"
    }
  ],
  "count": 1,
  "machinesQueried": 3,
  "machinesFailed": 0
}
```

---

### GET /api/sessions

List all RC sessions with pagination and filtering.

**Query Parameters**

| Parameter   | Type   | Description                                                                      |
|-------------|--------|----------------------------------------------------------------------------------|
| `machineId` | string | Filter by machine                                                                 |
| `agentId`   | string | Filter by agent                                                                   |
| `status`    | string | Filter by status: `starting`, `active`, `paused`, `ended`, `error`               |
| `limit`     | number | Page size (default 20)                                                            |
| `offset`    | number | Pagination offset                                                                 |

**Response 200**

```json
{
  "sessions": [
    {
      "id": "550e8400-...",
      "agentId": "d4e5f6a7-...",
      "agentName": "auth-agent",
      "machineId": "mac-mini-01",
      "status": "active",
      "projectPath": "/home/user/project",
      "model": "claude-sonnet-4-6",
      "claudeSessionId": "sess-abc",
      "startedAt": "2026-03-19T10:00:00.000Z",
      "lastHeartbeat": "2026-03-19T10:05:00.000Z"
    }
  ],
  "total": 100,
  "limit": 20,
  "offset": 0,
  "hasMore": true
}
```

---

### GET /api/sessions/:sessionId

Get a single session by its control-plane UUID.

**Response 200** — Single session record with `agentName` resolved

**Error Codes**: `SESSION_NOT_FOUND` (404)

---

### POST /api/sessions

Create a new RC session and dispatch it to the worker.

**Request Body**

| Field             | Type   | Required | Description                                              |
|-------------------|--------|----------|----------------------------------------------------------|
| `agentId`         | string | Yes      | Agent ID (or `"adhoc"` for one-off sessions)             |
| `machineId`       | string | Yes      | Target machine ID                                        |
| `projectPath`     | string | Yes      | Absolute project path                                    |
| `model`           | string | No       | Model override                                           |
| `prompt`          | string | No       | Initial prompt                                           |
| `resumeSessionId` | string | No       | Claude session ID to resume                              |
| `accountId`       | string | No       | API account to use (overrides agent default)             |
| `runtime`         | string | No       | Runtime type (e.g. `"claude-code"`)                      |

```json
POST /api/sessions
{
  "agentId": "d4e5f6a7-...",
  "machineId": "mac-mini-01",
  "projectPath": "/home/user/project",
  "prompt": "Implement OAuth login"
}
```

**Response 201**

```json
{
  "ok": true,
  "sessionId": "550e8400-...",
  "session": { "id": "550e8400-...", "status": "active", "..." }
}
```

**Response 502** — If worker dispatch failed:
```json
{ "ok": false, "sessionId": "...", "error": "DISPATCH_FAILED", "message": "..." }
```

**Error Codes**: `INVALID_*` (400) | `AGENT_NOT_FOUND` / `MACHINE_NOT_FOUND` (404) | `MACHINE_OFFLINE` (503)

---

### GET /api/sessions/content/:sessionId

Read JSONL conversation history for a session (proxied from the worker machine).

**Query Parameters**

| Parameter     | Type   | Required | Description                      |
|---------------|--------|----------|----------------------------------|
| `machineId`   | string | Yes      | Machine that owns the session    |
| `projectPath` | string | No       | Project path hint                |
| `limit`       | number | No       | Max messages to return           |

**Response 200** — Parsed JSONL message array (worker-specific format)

**Error Codes**: `INVALID_MACHINE_ID` (400) | `MACHINE_NOT_FOUND` (404) | `MACHINE_OFFLINE` (503) | `SESSION_CONTENT_NOT_FOUND` (404) | `WORKER_ERROR` (502)

---

### POST /api/sessions/:sessionId/message

Send a message to an active session (proxied to the worker).

**Request Body**

| Field     | Type   | Required | Description                  |
|-----------|--------|----------|------------------------------|
| `message` | string | Yes      | Message text to send         |

**Response 200**

```json
{ "ok": true, "sessionId": "...", "workerResponse": { "ok": true } }
```

**Error Codes**: `INVALID_MESSAGE` (400) | `SESSION_NOT_FOUND` (404) | `SESSION_NOT_ACTIVE` (409) | `MACHINE_OFFLINE` (503) | `SESSION_LOST` (410)

---

### POST /api/sessions/:sessionId/resume

Resume a paused or ended session.

**Request Body**

| Field   | Type   | Required | Description             |
|---------|--------|----------|-------------------------|
| `prompt`| string | Yes      | Prompt to resume with   |
| `model` | string | No       | Model override          |

**Response 200** — `{ "ok": true, "session": { ... } }`

**Error Codes**: `INVALID_PROMPT` (400) | `SESSION_NOT_FOUND` (404) | `SESSION_ALREADY_ACTIVE` (409) | `MACHINE_OFFLINE` (503) | `SESSION_LOST` (410)

---

### POST /api/sessions/:sessionId/fork

Fork a session — creates a new session based on an existing one, optionally with context truncation or injection.

**Request Body**

| Field              | Type     | Required | Description                                                                           |
|--------------------|----------|----------|---------------------------------------------------------------------------------------|
| `prompt`           | string   | Yes      | Prompt for the forked session                                                         |
| `machineId`        | string   | No       | Target machine (defaults to parent's machine)                                         |
| `accountId`        | string   | No       | API account override                                                                  |
| `model`            | string   | No       | Model override                                                                        |
| `strategy`         | string   | No       | Fork strategy: `"resume"` (default), `"jsonl-truncation"`, `"context-injection"`     |
| `forkAtIndex`      | number   | No       | Message index for `jsonl-truncation` strategy                                         |
| `selectedMessages` | array    | No       | Messages to inject for `context-injection` strategy                                   |

```json
POST /api/sessions/550e8400-.../fork
{
  "prompt": "Continue from message 10",
  "strategy": "jsonl-truncation",
  "forkAtIndex": 10
}
```

**Response 201**

```json
{
  "ok": true,
  "sessionId": "new-session-uuid",
  "session": { "..." },
  "forkedFrom": "550e8400-..."
}
```

**Error Codes**: `INVALID_PROMPT` (400) | `NO_CLAUDE_SESSION` (400) | `SESSION_NOT_FOUND` / `MACHINE_NOT_FOUND` (404) | `MACHINE_OFFLINE` (503)

---

### GET /api/sessions/:sessionId/stream

SSE stream of session output — proxied from the worker machine.

**Response 200** (`Content-Type: text/event-stream`) — Raw SSE events from the agent

**Error Codes**: `SESSION_NOT_FOUND` (404) | `MACHINE_OFFLINE` (503) | `SESSION_LOST` (410) | `WORKER_ERROR` (502)

---

### PATCH /api/sessions/:sessionId/status

Worker callback to report session status changes (e.g., `active`, `ended`, `error`).

**Request Body** (all fields optional)

| Field             | Type          | Description                              |
|-------------------|---------------|------------------------------------------|
| `status`          | string        | New status                               |
| `claudeSessionId` | string\|null  | Claude session ID once known             |
| `pid`             | number\|null  | OS process ID of the CLI                 |
| `costUsd`         | number        | Current accumulated cost                 |
| `errorMessage`    | string        | Error description                        |
| `messageCount`    | number        | Current message count                    |

**Response 200** — `{ "ok": true, "session": { ... } }`

**Error Codes**: `SESSION_NOT_FOUND` (404) | `INVALID_STATUS` (400)

---

### DELETE /api/sessions/:sessionId

End a session. Optionally purge from the database.

**Query Parameters**

| Parameter | Type   | Description                                |
|-----------|--------|--------------------------------------------|
| `purge`   | string | Pass `true` to permanently delete the record |

**Response 200** — `{ "ok": true, "sessionId": "..." }`

**Error Codes**: `SESSION_NOT_FOUND` (404)

---

## 5. Runs

Agent run lifecycle tracking. Mounted within `/api/agents/:id/`.

### GET /api/agents/:agentId/runs

See [Agents — GET /runs](#get-apiagentsagentidruns) above.

### POST /api/agents/:id/complete

See [Agents — POST /complete](#post-apiagentsidcomplete) above.

---

## 6. Tasks

Task graphs model multi-step DAG workflows. Task runs are individual executions of graph nodes.

### Task Graphs — `/api/task-graphs`

#### GET /api/task-graphs

List all task graphs.

**Response 200** — Array of graph records

---

#### POST /api/task-graphs

Create a task graph.

**Request Body**

| Field  | Type   | Required | Description       |
|--------|--------|----------|-------------------|
| `name` | string | Yes      | Graph name        |

**Response 201** — Created graph record

---

#### GET /api/task-graphs/:id

Get a graph with all definitions and edges.

**Response 200**

```json
{
  "id": "graph-uuid",
  "name": "Auth Feature",
  "definitions": [
    { "id": "def-1", "type": "claude_task", "name": "Write Tests" }
  ],
  "edges": [
    { "id": "edge-1", "fromDefinition": "def-1", "toDefinition": "def-2", "type": "sequence" }
  ]
}
```

**Error Codes**: `GRAPH_NOT_FOUND` (404)

---

#### DELETE /api/task-graphs/:id

Delete a task graph.

**Response 200** — `{ "ok": true }`

**Error Codes**: `GRAPH_NOT_FOUND` (404)

---

#### POST /api/task-graphs/:id/definitions

Add a task definition to a graph.

**Request Body**

| Field                 | Type     | Required | Description                                                              |
|-----------------------|----------|----------|--------------------------------------------------------------------------|
| `type`                | string   | Yes      | Node type (e.g. `"claude_task"`, `"human_review"`, `"webhook"`)         |
| `name`                | string   | Yes      | Display name                                                             |
| `description`         | string   | No       | Optional description                                                     |
| `requiredCapabilities`| string[] | No       | Capabilities required to execute this task                               |
| `estimatedTokens`     | number   | No       | Token budget hint                                                        |
| `timeoutMs`           | number   | No       | Execution timeout                                                        |
| `maxRetryAttempts`    | number   | No       | Max retries                                                              |
| `retryBackoffMs`      | number   | No       | Backoff between retries                                                  |

**Response 201** — Created definition record

**Error Codes**: `GRAPH_NOT_FOUND` (404) | `INVALID_TYPE` / `INVALID_NAME` (400)

---

#### POST /api/task-graphs/:id/edges

Add a directed edge to a task graph. Validates the resulting DAG.

**Request Body**

| Field            | Type   | Required | Description                                   |
|------------------|--------|----------|-----------------------------------------------|
| `fromDefinition` | string | Yes      | Source definition ID                           |
| `toDefinition`   | string | Yes      | Target definition ID                           |
| `type`           | string | Yes      | Edge type (e.g. `"sequence"`, `"conditional"`) |

**Response 201** — Created edge

**Error Codes**: `GRAPH_NOT_FOUND` (404) | `INVALID_EDGE` / `INVALID_EDGE_TYPE` (400) | `INVALID_DAG` (400 — adding this edge would create a cycle)

---

#### POST /api/task-graphs/:id/validate

Validate the graph's DAG structure.

**Response 200** — `{ "valid": true, "errors": [] }`

---

#### GET /api/task-graphs/:id/ready

Get task definitions that are ready to execute (all dependencies completed).

**Response 200** — Array of ready definition records

---

### Task Runs — `/api/task-runs`

#### GET /api/task-runs

List all task runs.

**Response 200** — Array of task run records

---

#### POST /api/task-runs

Create a task run.

**Request Body**

| Field          | Type   | Required | Description               |
|----------------|--------|----------|---------------------------|
| `definitionId` | string | Yes      | Task definition to run    |
| `spaceId`      | string | No       | Associated space          |
| `threadId`     | string | No       | Associated thread         |

**Response 201** — Created run record

**Error Codes**: `INVALID_DEFINITION_ID` (400)

---

#### GET /api/task-runs/:id

Get a task run with its current worker lease.

**Response 200** — Run record with `lease` field

**Error Codes**: `RUN_NOT_FOUND` (404)

---

#### PATCH /api/task-runs/:id

Update task run status.

**Request Body**

| Field    | Type   | Required | Description                                                             |
|----------|--------|----------|-------------------------------------------------------------------------|
| `status` | string | Yes      | New status (e.g. `"running"`, `"completed"`, `"failed"`, `"pending"`)  |
| `result` | object | No       | Success result payload                                                  |
| `error`  | object | No       | Error details                                                           |

**Response 200** — Updated run record

**Error Codes**: `INVALID_STATUS` (400) | `RUN_NOT_FOUND` (404)

---

#### POST /api/task-runs/:id/claim

Claim a worker lease for this task run (must be in `pending` status).

**Request Body**

| Field             | Type   | Required | Description                        |
|-------------------|--------|----------|------------------------------------|
| `workerId`        | string | Yes      | Worker machine ID                  |
| `agentInstanceId` | string | Yes      | Agent instance that will run this  |
| `durationMs`      | number | No       | Lease duration in milliseconds     |

**Response 201** — Lease record

**Error Codes**: `INVALID_WORKER_ID` / `INVALID_AGENT_INSTANCE_ID` (400) | `RUN_NOT_FOUND` (404) | `RUN_NOT_CLAIMABLE` / `LEASE_ALREADY_EXISTS` (409)

---

#### POST /api/task-runs/:id/heartbeat

Renew a worker lease and update the last-seen timestamp.

**Request Body**

| Field        | Type   | Description                  |
|--------------|--------|------------------------------|
| `durationMs` | number | Extend lease by this amount  |

**Response 200** — Updated lease record

**Error Codes**: `LEASE_NOT_FOUND` (404)

---

## 7. Memory

Hybrid memory system. Supports both Mem0 and PostgreSQL native backends. Mounted at `/api/memory`.

### GET /api/memory

List all memories (facts).

**Query Parameters**

| Parameter | Type   | Description             |
|-----------|--------|-------------------------|
| `userId`  | string | Filter by user (Mem0)   |
| `agentId` | string | Filter by agent          |

**Response 200** — `{ "results": [ { "id": "...", "memory": "...", "agentId": "...", "createdAt": "..." } ] }`

---

### POST /api/memory/search

Semantic search over memories.

**Request Body**

| Field     | Type   | Required | Description                    |
|-----------|--------|----------|--------------------------------|
| `query`   | string | Yes      | Semantic search query          |
| `agentId` | string | No       | Scope results to agent         |
| `limit`   | number | No       | Max results                    |

```json
POST /api/memory/search
{ "query": "authentication implementation decisions", "agentId": "d4e5f6a7-..." }
```

**Response 200**

```json
{
  "results": [
    { "id": "fact-uuid", "memory": "We use JWT tokens for auth", "score": 0.94, "agentId": "..." }
  ]
}
```

**Error Codes**: `INVALID_PARAMS` (400)

---

### POST /api/memory/add

Add a memory entry.

**Request Body**

| Field      | Type   | Required | Description                            |
|------------|--------|----------|----------------------------------------|
| `messages` | array  | Yes      | Array of `{ role, content }` objects   |
| `agentId`  | string | No       | Agent scope                            |
| `metadata` | object | No       | Extra metadata (sessionId, runId, etc.)|

**Response 200** — `{ "ok": true, "results": [ { "id": "...", "memory": "..." } ] }`

---

### DELETE /api/memory/:id

Delete a memory by ID.

**Response 200** — `{ "ok": true, "memoryId": "..." }`

---

### Memory Facts — `/api/memory/facts`

Full CRUD for structured memory facts (PostgreSQL backend only).

#### GET /api/memory/facts

Search or list facts.

**Query Parameters**

| Parameter      | Type   | Description                                              |
|----------------|--------|----------------------------------------------------------|
| `q`            | string | Semantic search query                                    |
| `scope`        | string | Filter by scope (e.g. `global`, `agent:uuid`)            |
| `entityType`   | string | Filter by entity type                                    |
| `sessionId`    | string | Filter by source session                                 |
| `agentId`      | string | Filter by source agent                                   |
| `machineId`    | string | Filter by source machine                                 |
| `minConfidence`| number | Minimum confidence score (0–1)                           |
| `limit`        | number | Max results (default 50)                                 |
| `offset`       | number | Pagination offset                                        |

**Response 200** — `{ "ok": true, "facts": [...], "total": 120 }`

---

#### POST /api/memory/facts

Create a memory fact.

**Request Body**

| Field        | Type   | Required | Description                                                   |
|--------------|--------|----------|---------------------------------------------------------------|
| `content`    | string | Yes      | Fact text                                                     |
| `scope`      | string | Yes      | Memory scope (e.g. `"global"`, `"agent:uuid"`)                |
| `entityType` | string | Yes      | Entity type (e.g. `"concept"`, `"decision"`, `"person"`)      |
| `confidence` | number | No       | Confidence score 0–1                                          |
| `source`     | object | No       | Source provenance (`session_id`, `agent_id`, etc.)            |

**Response 201** — `{ "ok": true, "fact": { ... } }`

---

#### GET /api/memory/facts/:id

Get a fact with its graph edges.

**Response 200** — `{ "ok": true, "fact": { ... }, "edges": [...] }`

**Error Codes**: `NOT_FOUND` (404)

---

#### PATCH /api/memory/facts/:id

Update editable fact fields.

**Request Body** (all optional): `scope`, `content`, `entityType`, `confidence`, `strength`

**Response 200** — `{ "ok": true, "fact": { ... } }`

---

#### DELETE /api/memory/facts/:id

Invalidate (soft-delete) a memory fact.

**Response 200** — `{ "ok": true, "id": "..." }`

---

#### POST /api/memory/facts/:id/feedback

Record a feedback signal on a fact.

**Request Body**

| Field    | Type   | Required | Description                              |
|----------|--------|----------|------------------------------------------|
| `signal` | string | Yes      | One of: `"used"`, `"irrelevant"`, `"outdated"` |

**Response 200** — `{ "ok": true, "fact": { ... } }`

---

### Memory Edges — `/api/memory/edges`

#### GET /api/memory/edges

List edges.

**Query Parameters**: `sourceFactId`, `targetFactId`

**Response 200** — `{ "ok": true, "edges": [...] }`

---

#### POST /api/memory/edges

Create an edge between two facts.

**Request Body**

| Field          | Type   | Required | Description                                           |
|----------------|--------|----------|-------------------------------------------------------|
| `sourceFactId` | string | Yes      | Source fact UUID                                      |
| `targetFactId` | string | Yes      | Target fact UUID                                      |
| `relation`     | string | Yes      | Relation type (e.g. `"relates_to"`, `"contradicts"`, `"supports"`) |
| `weight`       | number | No       | Edge weight (0–1)                                     |

**Response 201** — `{ "ok": true, "edge": { ... } }`

---

#### DELETE /api/memory/edges/:id

Delete a memory edge.

**Response 200** — `{ "ok": true, "id": "..." }`

---

### Memory Graph — `/api/memory/graph`

#### GET /api/memory/graph

Retrieve the full memory graph (nodes + edges) for visualization.

**Query Parameters**: `scope`, `entityType`, `limit` (default 200)

**Response 200** — `{ "ok": true, "nodes": [...], "edges": [...] }`

---

### Memory Scopes — `/api/memory/scopes`

#### GET /api/memory/scopes

List all scopes with fact counts.

**Response 200**

```json
{
  "ok": true,
  "scopes": [
    { "id": "global", "name": "global", "type": "global", "parentId": null, "factCount": 142 },
    { "id": "agent:uuid", "name": "uuid", "type": "agent", "parentId": "global", "factCount": 35 }
  ]
}
```

---

#### POST /api/memory/scopes

Create a new scope.

**Request Body**

| Field  | Type   | Required | Description                                         |
|--------|--------|----------|-----------------------------------------------------|
| `name` | string | Yes      | Scope name (max 128 chars)                          |
| `type` | string | Yes      | One of: `"global"`, `"project"`, `"agent"`, `"session"` |

**Response 201** — `{ "ok": true, "scope": { ... } }`

**Error Codes**: `SCOPE_EXISTS` (409)

---

#### PATCH /api/memory/scopes/:id

Rename a scope.

**Request Body** — `{ "name": "new-name" }`

**Error Codes**: `CANNOT_RENAME_GLOBAL` (400) | `SCOPE_EXISTS` (409)

---

#### DELETE /api/memory/scopes/:id

Delete a scope.

**Query Parameters**

| Parameter | Type   | Description                                               |
|-----------|--------|-----------------------------------------------------------|
| `cascade` | string | Pass `true` to delete all facts in the scope              |

**Error Codes**: `CANNOT_DELETE_GLOBAL` (400) | `SCOPE_NOT_EMPTY` (409 — without `cascade=true`)

---

#### POST /api/memory/scopes/:id/promote

Promote all facts in a scope to its parent scope.

**Response 200**

```json
{ "ok": true, "promoted": 35, "fromScope": "agent:uuid", "toScope": "global" }
```

---

#### POST /api/memory/scopes/:id/merge

Merge a scope into another.

**Request Body** — `{ "targetId": "target-scope-id" }`

**Response 200** — `{ "ok": true, "merged": 35, "fromScope": "...", "toScope": "..." }`

---

### Memory Consolidation — `/api/memory/consolidation`

Detects structural quality issues (contradictions, near-duplicates, stale facts, orphans).

#### GET /api/memory/consolidation

List consolidation items.

**Query Parameters**

| Parameter | Type   | Description                                                                    |
|-----------|--------|--------------------------------------------------------------------------------|
| `type`    | string | One of: `"contradiction"`, `"near-duplicate"`, `"stale"`, `"orphan"`          |
| `status`  | string | Filter by status (`"pending"` is the only currently meaningful value)          |
| `limit`   | number | Max items (default 50, max 200)                                                |

**Response 200**

```json
{
  "ok": true,
  "items": [
    {
      "id": "contradiction-edge-uuid",
      "type": "contradiction",
      "severity": "high",
      "factIds": ["fact-a", "fact-b"],
      "suggestion": "Review contradicting facts and resolve the conflict.",
      "reason": "Fact \"X\" contradicts \"Y\"",
      "status": "pending",
      "createdAt": "2026-03-19T10:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

#### POST /api/memory/consolidation/:id/action

Resolve a consolidation item.

**Request Body**

| Field    | Type   | Required | Description                              |
|----------|--------|----------|------------------------------------------|
| `action` | string | Yes      | Action taken (e.g. `"merge"`, `"keep"`) |
| `status` | string | Yes      | New status: `"accepted"` or `"skipped"` |

**Response 200** — `{ "ok": true }`

---

### Memory Reports — `/api/memory/reports`

#### GET /api/memory/reports

List previously generated reports (in-memory cache, ephemeral).

**Query Parameters**: `reportType`, `scope`, `limit`

**Response 200** — `{ "ok": true, "reports": [...], "total": 5 }`

---

#### POST /api/memory/reports/generate

Generate a memory report using SQL aggregation.

**Request Body**

| Field        | Type   | Required | Description                                                                       |
|--------------|--------|----------|-----------------------------------------------------------------------------------|
| `reportType` | string | Yes      | `"project-progress"`, `"knowledge-health"`, or `"activity-digest"`               |
| `scope`      | string | No       | Scope filter (e.g. `"agent:uuid"`)                                                |
| `timeRange`  | string | No       | `"last-7d"`, `"last-30d"`, `"last-90d"`, `"all-time"` (default: `"last-30d"`)   |

**Response 200**

```json
{
  "ok": true,
  "report": {
    "id": "report-uuid",
    "reportType": "project-progress",
    "scope": null,
    "timeRange": "last-30d",
    "markdown": "# Project Progress Report\n...",
    "generatedAt": "2026-03-19T10:00:00.000Z"
  }
}
```

**Error Codes**: `INVALID_REPORT_TYPE` (400)

---

## 8. Spaces & Collaboration

Spaces are collaborative contexts (channels, rooms) for agents and humans. Mounted at `/api/spaces`.

### GET /api/spaces

List all spaces.

**Response 200** — Array of space records

---

### POST /api/spaces

Create a space.

**Request Body**

| Field         | Type   | Required | Description                                                                     |
|---------------|--------|----------|---------------------------------------------------------------------------------|
| `name`        | string | Yes      | Space name (max 256 chars)                                                      |
| `createdBy`   | string | Yes      | Creator ID                                                                      |
| `description` | string | No       | Description                                                                     |
| `type`        | string | No       | Space type (e.g. `"collaboration"`, `"mission"`, `"channel"`)                  |
| `visibility`  | string | No       | `"private"` (default) or `"public"`                                             |

**Response 201** — Created space record

---

### GET /api/spaces/:id

Get a space with members.

**Response 200** — `{ ...space, "members": [...] }`

**Error Codes**: `SPACE_NOT_FOUND` (404)

---

### DELETE /api/spaces/:id

Delete a space.

**Response 200** — `{ "ok": true }`

---

### POST /api/spaces/:id/members

Add a member to a space.

**Request Body**

| Field                | Type   | Required | Description                                                             |
|----------------------|--------|----------|-------------------------------------------------------------------------|
| `memberType`         | string | Yes      | `"human"` or `"agent"`                                                  |
| `memberId`           | string | Yes      | User or agent ID                                                        |
| `role`               | string | No       | Member role (e.g. `"observer"`, `"participant"`, `"admin"`)             |
| `subscriptionFilter` | object | No       | `{ threadTypes?: string[], minVisibility?: string }`                    |

**Response 201** — Member record

---

### PATCH /api/spaces/:id/members/:memberId/filter

Update a member's subscription filter.

**Query Parameters**: `memberType` (default `"human"`)

**Request Body** — `{ "subscriptionFilter": { "threadTypes": ["discussion"], "minVisibility": "public" } }`

**Response 200** — Updated member record

---

### DELETE /api/spaces/:id/members/:memberId

Remove a member from a space.

**Query Parameters**: `memberType` (default `"human"`)

**Response 200** — `{ "ok": true }`

---

### GET /api/spaces/:id/threads

List threads in a space.

**Response 200** — Array of thread records

---

### POST /api/spaces/:id/threads

Create a thread in a space.

**Request Body**

| Field   | Type   | Description                                          |
|---------|--------|------------------------------------------------------|
| `type`  | string | Thread type (e.g. `"discussion"`, `"task"`, `"log"`) |
| `title` | string | Optional title                                       |

**Response 201** — Created thread record

---

### GET /api/spaces/:id/threads/:threadId

Get a thread by ID.

**Error Codes**: `THREAD_NOT_FOUND` (404)

---

### DELETE /api/spaces/:id/threads/:threadId

Delete a thread.

**Response 200** — `{ "ok": true }`

---

### GET /api/spaces/:id/threads/:threadId/events

Get events in a thread.

**Query Parameters**

| Parameter | Type   | Description                           |
|-----------|--------|---------------------------------------|
| `after`   | number | Return events with sequence > `after` |
| `limit`   | number | Max events                            |

**Response 200** — Array of event records

---

### POST /api/spaces/:id/threads/:threadId/events

Append an event to a thread.

**Request Body**

| Field            | Type   | Required | Description                                                  |
|------------------|--------|----------|--------------------------------------------------------------|
| `idempotencyKey` | string | Yes      | Unique key to prevent duplicate events                       |
| `type`           | string | Yes      | Event type (e.g. `"message"`, `"status_change"`, `"tool_call"`) |
| `senderType`     | string | Yes      | `"human"` or `"agent"`                                       |
| `senderId`       | string | Yes      | Sender ID                                                    |
| `correlationId`  | string | No       | Correlation ID for tracing                                   |
| `payload`        | object | No       | Event data                                                   |
| `visibility`     | string | No       | `"public"`, `"private"`, `"internal"`                        |

**Response 201** — Created event record

---

## 9. Approvals & Permissions

### Approval Gates — `/api/approvals`

Human-in-the-loop approval gates for agent actions.

#### POST /api/approvals

Create an approval gate.

**Request Body**

| Field                | Type     | Required | Description                                                     |
|----------------------|----------|----------|-----------------------------------------------------------------|
| `taskDefinitionId`   | string   | Yes      | Associated task definition                                      |
| `taskRunId`          | string   | No       | Associated task run                                             |
| `threadId`           | string   | No       | Collaboration thread for notifications                          |
| `requiredApprovers`  | string[] | No       | Specific approver IDs required                                  |
| `requiredCount`      | number   | No       | Minimum number of approvals needed                              |
| `timeoutMs`          | number   | No       | Auto-timeout duration                                           |
| `timeoutPolicy`      | string   | No       | Behavior on timeout: `"auto_approve"`, `"auto_reject"`, `"block"` |
| `contextArtifactIds` | string[] | No       | Artifact IDs to include as context                              |

**Response 201** — Created gate record

---

#### GET /api/approvals

List approval gates by thread.

**Query Parameters** — `threadId` (required)

**Response 200** — Array of gate records

---

#### GET /api/approvals/:id

Get a gate with all decisions.

**Response 200** — `{ ...gate, "decisions": [...] }`

**Error Codes**: `GATE_NOT_FOUND` (404)

---

#### POST /api/approvals/:id/decisions

Add a decision to an approval gate.

**Request Body**

| Field        | Type    | Required | Description                              |
|--------------|---------|----------|------------------------------------------|
| `decidedBy`  | string  | Yes      | User or agent making the decision        |
| `action`     | string  | Yes      | `"approve"` or `"reject"`               |
| `comment`    | string  | No       | Optional comment                         |
| `viaTimeout` | boolean | No       | Whether this decision was auto-triggered |

**Response 201** — Decision record

**Error Codes**: `GATE_NOT_FOUND` (404) | `GATE_ALREADY_RESOLVED` (409)

---

#### GET /api/approvals/:id/decisions

List decisions for a gate.

**Response 200** — Array of decision records

**Error Codes**: `GATE_NOT_FOUND` (404)

---

### Permission Requests — `/api/permission-requests`

Real-time tool permission requests from agents to human operators.

#### POST /api/permission-requests

Create a permission request (called by the agent worker before executing a sensitive tool).

**Request Body**

| Field            | Type   | Required | Description                                      |
|------------------|--------|----------|--------------------------------------------------|
| `agentId`        | string | Yes      | Agent requesting permission                      |
| `sessionId`      | string | Yes      | Session in which the request originated          |
| `machineId`      | string | Yes      | Machine where the agent is running               |
| `requestId`      | string | Yes      | Unique request ID (from the worker)              |
| `toolName`       | string | Yes      | Name of the tool requiring permission            |
| `toolInput`      | object | No       | Tool input parameters                            |
| `description`    | string | No       | Human-readable description of the action         |
| `timeoutSeconds` | number | Yes      | Auto-deny after this many seconds                |

```json
POST /api/permission-requests
{
  "agentId": "d4e5f6a7-...",
  "sessionId": "550e8400-...",
  "machineId": "mac-mini-01",
  "requestId": "perm-req-uuid",
  "toolName": "Bash",
  "toolInput": { "command": "rm -rf /tmp/old-build" },
  "description": "Delete old build artifacts",
  "timeoutSeconds": 60
}
```

**Response 201** — Created permission request record. A WebSocket broadcast is also sent to all connected clients.

**Error Codes**: `INVALID_*` (400)

---

#### GET /api/permission-requests

List permission requests.

**Query Parameters**

| Parameter   | Type   | Description                                                            |
|-------------|--------|------------------------------------------------------------------------|
| `status`    | string | Filter: `"pending"`, `"approved"`, `"denied"`, `"expired"`, `"cancelled"` |
| `agentId`   | string | Filter by agent                                                        |
| `sessionId` | string | Filter by session                                                      |

**Response 200** — Array of permission request records ordered by `requestedAt` desc

---

#### PATCH /api/permission-requests/:id

Resolve a pending permission request (approve or deny).

**Request Header**

| Header       | Description                         |
|--------------|-------------------------------------|
| `x-user-id`  | Optional user ID for audit logging  |

**Request Body**

| Field        | Type   | Required | Description                              |
|--------------|--------|----------|------------------------------------------|
| `decision`   | string | Yes      | `"approved"` or `"denied"`              |
| `resolvedBy` | string | No       | User who made the decision (overrides header) |

**Response 200** — Updated permission request record. Decision is forwarded to the worker via HTTP.

**Error Codes**: `INVALID_DECISION` (400) | `PERMISSION_REQUEST_NOT_FOUND` (404) | `PERMISSION_REQUEST_ALREADY_RESOLVED` (409)

---

## 10. Settings & Accounts

### Settings — `/api/settings`

#### GET /api/settings/defaults

Get current default settings.

**Response 200**

```json
{ "defaultAccountId": "acc-uuid", "failoverPolicy": "priority" }
```

---

#### PUT /api/settings/defaults

Update default settings.

**Request Body** (at least one required)

| Field             | Type   | Description                                        |
|-------------------|--------|----------------------------------------------------|
| `defaultAccountId`| string | Default API account to use for new sessions        |
| `failoverPolicy`  | string | `"none"`, `"priority"`, or `"round_robin"`         |

**Response 200** — `{ "ok": true }`

---

#### GET /api/settings/project-accounts

List all project-to-account mappings.

**Response 200** — Array of mapping records

---

#### PUT /api/settings/project-accounts

Create or update a project-to-account mapping.

**Request Body**

| Field         | Type   | Required | Description                  |
|---------------|--------|----------|------------------------------|
| `projectPath` | string | Yes      | Absolute project path        |
| `accountId`   | string | Yes      | API account to use           |

**Response 200** — Upserted mapping record

---

#### DELETE /api/settings/project-accounts/:id

Delete a project-to-account mapping.

**Response 200** — `{ "ok": true }`

**Error Codes**: `MAPPING_NOT_FOUND` (404)

---

### API Accounts — `/api/accounts`

Manage encrypted API credentials for LLM providers.

#### GET /api/accounts

List all accounts (credentials are masked).

**Response 200**

```json
[
  {
    "id": "acc-uuid",
    "name": "Primary Anthropic",
    "provider": "anthropic_api",
    "credentialMasked": "sk-ant-...XXXX",
    "priority": 0,
    "isActive": true,
    "createdAt": "2026-03-01T00:00:00.000Z"
  }
]
```

---

#### GET /api/accounts/:id

Get a single account.

**Response 200** — Account record with masked credential

**Error Codes**: `ACCOUNT_NOT_FOUND` (404)

---

#### POST /api/accounts

Create an account.

**Request Body**

| Field        | Type   | Required | Description                                                            |
|--------------|--------|----------|------------------------------------------------------------------------|
| `name`       | string | Yes      | Account name (max 100 chars)                                           |
| `provider`   | string | Yes      | Provider: `"anthropic_api"`, `"openai_api"`, `"claude_max"`, `"claude_team"`, `"bedrock"`, `"vertex"` |
| `credential` | string | Yes      | API key or credential string (encrypted at rest)                       |
| `priority`   | number | No       | Priority order for failover (lower = higher priority)                  |
| `metadata`   | object | No       | Arbitrary metadata                                                     |

**Response 201** — Account record with masked credential

**Error Codes**: `INVALID_BODY` (400)

---

#### PUT /api/accounts/:id

Update an account.

**Request Body** (all optional): `name`, `provider`, `credential`, `priority`, `isActive`, `rateLimit` (`{ itpm, otpm }`), `metadata`

**Response 200** — Updated account record

**Error Codes**: `INVALID_BODY` (400) | `ACCOUNT_NOT_FOUND` (404)

---

#### DELETE /api/accounts/:id

Delete an account and its project mappings.

**Response 200** — `{ "ok": true, "removedMappings": 2 }`

**Error Codes**: `ACCOUNT_NOT_FOUND` (404)

---

#### POST /api/accounts/:id/test

Test account connectivity with a minimal API call.

**Response 200**

```json
{ "ok": true, "latencyMs": 342 }
```

On failure:

```json
{ "ok": false, "error": "Rate limit exceeded" }
```

**Error Codes**: `ACCOUNT_NOT_FOUND` (404) | `ACCOUNT_TEST_ERROR` (500) | `UNKNOWN_PROVIDER` (400)

---

## 11. Discovery & Skills

### GET /api/skills/discover

Proxy skill discovery to a worker machine. Reads global and project `SKILL.md` files.

**Query Parameters**

| Parameter     | Type   | Required | Description                          |
|---------------|--------|----------|--------------------------------------|
| `machineId`   | string | Yes      | Target machine ID                    |
| `projectPath` | string | No       | Project directory to scan            |
| `runtime`     | string | No       | Runtime type (default `"claude-code"`) |

**Response 200** — Proxied worker skill discovery response

```json
{
  "discovered": [
    { "id": "commit", "name": "Git Commit", "description": "..." }
  ],
  "count": 1
}
```

**Error Codes**: `INVALID_INPUT` (400) | `INVALID_RUNTIME` (400) | `REGISTRY_UNAVAILABLE` (503) | `WORKER_UNREACHABLE` (502)

---

## 12. Deployment

Manage multi-tier deployments (dev-1, dev-2, beta). Mounted at `/api/deployment`.

### GET /api/deployment/tiers

List all configured tiers with service health status.

**Response 200**

```json
{
  "tiers": [
    {
      "name": "beta",
      "label": "Production (Beta)",
      "status": "running",
      "services": [
        { "name": "cp", "port": 8080, "healthy": true, "memoryMb": 256, "uptimeSeconds": 3600 },
        { "name": "worker", "port": 9000, "healthy": true, "memoryMb": 128 },
        { "name": "web", "port": 5173, "healthy": true }
      ],
      "config": { "cpPort": 8080, "workerPort": 9000, "webPort": 5173 }
    }
  ]
}
```

---

### GET /api/deployment/preflight/:tier

Run preflight checks for promoting a source tier.

**Path Parameters**: `tier` — source tier name (e.g. `"dev-1"`)

**Response 200**

```json
{
  "ready": true,
  "checks": [
    { "name": "build", "passed": true, "message": "Build successful" },
    { "name": "tests", "passed": true, "message": "All tests pass" }
  ]
}
```

**Error Codes**: `INVALID_SOURCE` (400)

---

### POST /api/deployment/promote/preflight

Preflight check via POST body.

**Request Body** — `{ "source": "dev-1" }`

**Response 200** — Same as GET preflight

---

### POST /api/deployment/promote

Start a tier promotion (rate-limited: 1 request per 30 seconds).

**Request Body**

| Field    | Type   | Required | Description             |
|----------|--------|----------|-------------------------|
| `source` | string | Yes      | Source tier to promote  |

**Response 202**

```json
{ "id": "promo-uuid", "status": "pending" }
```

**Error Codes**: `INVALID_SOURCE` (400) | `PROMOTION_IN_PROGRESS` (409)

---

### GET /api/deployment/promote/:id/stream

SSE stream of promotion progress events.

**Response 200** (`Content-Type: text/event-stream`)

```
data: {"type":"step","step":"build","message":"Building packages..."}

data: {"type":"step","step":"tests","message":"Running test suite..."}

data: {"type":"complete","status":"success","durationMs":45000}
```

---

### GET /api/deployment/history

Promotion history.

**Query Parameters**

| Parameter | Type   | Default | Description            |
|-----------|--------|---------|------------------------|
| `limit`   | number | 20      | Max records (max 100)  |
| `offset`  | number | 0       | Pagination offset      |

**Response 200**

```json
{
  "records": [
    {
      "id": "promo-uuid",
      "source": "dev-1",
      "status": "success",
      "startedAt": "2026-03-19T10:00:00.000Z",
      "durationMs": 45000
    }
  ],
  "total": 15
}
```

---

## 13. Router (LiteLLM)

LiteLLM proxy integration for multi-provider model routing. Mounted at `/api/router`.

### GET /api/router/health

Check LiteLLM proxy health.

**Response 200**

```json
{ "status": "ok", "timestamp": "2026-03-19T10:00:00.000Z" }
```

**Response 503** — `{ "status": "degraded", "timestamp": "..." }`

---

### GET /api/router/models

List available model IDs from the LiteLLM proxy.

**Response 200** — `{ "models": ["claude-sonnet-4-6", "gpt-4o", "..."] }`

---

### GET /api/router/models/info

Get detailed model deployment info (costs, parameters, context windows, etc.).

**Response 200** — `{ "deployments": [ { "model_name": "...", "litellm_params": { ... } } ] }`

---

### GET /api/router/spend

Get LiteLLM spend log entries.

**Response 200** — `{ "entries": [...] }`

---

### POST /api/router/models/:id/test

Test a specific model with a tiny completion.

**Response 200**

```json
{ "ok": true, "modelId": "claude-sonnet-4-6", "responseModel": "claude-sonnet-4-6-20250219", "usage": { "input_tokens": 5, "output_tokens": 1 } }
```

**Error Codes**: `TEST_MODEL_FAILED` (500) — proxied LiteLLM error

---

## 14. Agent Profiles

Agent profiles define reusable configurations for agent instances. Mounted at `/api/agent-profiles`.

### GET /api/agent-profiles

List all agent profiles.

**Response 200** — Array of profile records

---

### POST /api/agent-profiles

Create an agent profile.

**Request Body**

| Field               | Type     | Required | Description                                               |
|---------------------|----------|----------|-----------------------------------------------------------|
| `name`              | string   | Yes      | Profile name                                              |
| `runtimeType`       | string   | Yes      | One of: `"claude-code"`, `"codex"`, `"openlaw"`, `"nanoclaw"` |
| `modelId`           | string   | Yes      | Model ID (e.g. `"claude-sonnet-4-6"`)                    |
| `providerId`        | string   | Yes      | Provider ID (e.g. `"anthropic"`)                          |
| `capabilities`      | string[] | No       | List of capability tags                                   |
| `toolScopes`        | string[] | No       | Allowed tool scopes                                       |
| `maxTokensPerTask`  | number   | No       | Token budget per task                                     |
| `maxCostPerHour`    | number   | No       | Cost budget per hour (USD)                                |

**Response 201** — Created profile record

---

### GET /api/agent-profiles/:id

Get an agent profile.

**Error Codes**: `PROFILE_NOT_FOUND` (404)

---

### DELETE /api/agent-profiles/:id

Delete an agent profile.

**Response 200** — `{ "ok": true }`

---

### GET /api/agent-profiles/:id/instances

List instances for a profile.

**Error Codes**: `PROFILE_NOT_FOUND` (404)

---

### POST /api/agent-profiles/:id/instances

Create an agent instance.

**Request Body**

| Field              | Type   | Description                   |
|--------------------|--------|-------------------------------|
| `machineId`        | string | Machine to run on             |
| `worktreeId`       | string | Git worktree ID               |
| `runtimeSessionId` | string | Runtime session ID            |
| `status`           | string | Initial status                |

**Response 201** — Instance record

---

### PATCH /api/agent-profiles/:id/instances/:instanceId

Update an agent instance.

**Request Body** (all optional): `status`, `machineId`, `worktreeId`, `runtimeSessionId`

**Response 200** — Updated instance record

**Error Codes**: `INSTANCE_NOT_FOUND` (404)

---

### DELETE /api/agent-profiles/:id/instances/:instanceId

Delete an agent instance.

**Response 200** — `{ "ok": true }`

**Error Codes**: `INSTANCE_NOT_FOUND` (404)

---

## 15. Notifications

User notification preferences. Mounted at `/api/notification-preferences`.

### GET /api/notification-preferences

List preferences for a user.

**Query Parameters** — `userId` (required)

**Response 200** — `{ "preferences": [...] }`

---

### GET /api/notification-preferences/:userId

Get preferences for a specific user.

**Response 200** — `{ "preferences": [...] }`

---

### POST /api/notification-preferences

Create or update a notification preference.

**Request Body**

| Field             | Type     | Required | Description                                                    |
|-------------------|----------|----------|----------------------------------------------------------------|
| `userId`          | string   | Yes      | User ID                                                        |
| `priority`        | string   | Yes      | Priority level: `"critical"`, `"high"`, `"medium"`, `"low"`   |
| `channels`        | string[] | Yes      | One or more of: `"push"`, `"email"`, `"sms"`, `"webhook"`    |
| `quietHoursStart` | string   | No       | Start of quiet hours in `HH:MM` format                        |
| `quietHoursEnd`   | string   | No       | End of quiet hours in `HH:MM` format                          |
| `timezone`        | string   | No       | Timezone identifier (e.g. `"America/Los_Angeles"`)             |

**Response 201** — `{ "ok": true, "preference": { ... } }`

---

### DELETE /api/notification-preferences/:id

Delete a notification preference.

**Response 200** — `{ "ok": true, "deletedId": "..." }`

**Error Codes**: `PREFERENCE_NOT_FOUND` (404)

---

## 16. Error Format

All error responses use a consistent format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

### Common Error Codes

| HTTP Status | Error Code                    | Description                                   |
|-------------|-------------------------------|-----------------------------------------------|
| 400         | `INVALID_BODY`                | Missing or invalid request field              |
| 400         | `INVALID_PARAMS`              | Invalid query parameters                      |
| 400         | `PROMPT_TOO_LONG`             | Prompt exceeds 32,000 character limit         |
| 404         | `AGENT_NOT_FOUND`             | Agent does not exist                          |
| 404         | `SESSION_NOT_FOUND`           | Session does not exist                        |
| 404         | `MACHINE_NOT_FOUND`           | Machine is not registered                     |
| 409         | `SESSION_ALREADY_ACTIVE`      | Session cannot be resumed — already active    |
| 409         | `GATE_ALREADY_RESOLVED`       | Approval gate already has a final decision    |
| 409         | `PROMOTION_IN_PROGRESS`       | Another tier promotion is already running     |
| 410         | `SESSION_LOST`                | Session was lost (worker restart)             |
| 501         | `DATABASE_NOT_CONFIGURED`     | Route requires a database but none is configured |
| 501         | `QUEUE_NOT_CONFIGURED`        | Route requires a task queue but none is configured |
| 502         | `WORKER_ERROR`                | Worker returned a non-OK response             |
| 502         | `WORKER_UNREACHABLE`          | Could not connect to the worker               |
| 503         | `MACHINE_OFFLINE`             | Target machine is offline                     |
| 503         | `NO_MACHINES_AVAILABLE`       | No online machines registered                 |
| 503         | `REGISTRY_UNAVAILABLE`        | Database registry not configured              |

---

*Generated from source — last updated 2026-03-19.*
