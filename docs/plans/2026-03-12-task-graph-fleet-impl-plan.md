# Task Graph + Fleet Implementation Plan (Phase 3)

**Date**: 2026-03-12
**Scope**: section 10.3 of multi-agent collaboration design
**Branch**: `feat/collaboration-phase3-task-graph`

## Overview

Deliver TaskDefinition/TaskRun split, WorkerLease claim protocol, pluggable TaskExecutor, DAG validation, worker node registration, fleet overview, and Fastify routes.

## Deliverables

### Layer 1: Shared Types (`packages/shared/src/types/`)

**File: `task-graph.ts`** (~120 lines)
- `TASK_NODE_TYPES`, `TASK_EDGE_TYPES`, `TASK_RUN_STATUSES`, `WORKER_NODE_STATUSES` const arrays
- Types: `TaskGraph`, `TaskDefinition`, `TaskEdge`, `TaskRun`, `WorkerLease`, `WorkerNode`
- Guard functions: `isTaskNodeType()`, `isTaskEdgeType()`, `isTaskRunStatus()`, `isWorkerNodeStatus()`

**File: `task-executor.ts`** (~30 lines)
- `TaskExecutor` interface: `submit()`, `cancel()`, `getStatus()`

Update `packages/shared/src/types/index.ts` to re-export both.

### Layer 2: DB Schema (`packages/control-plane/src/db/`)

**File: `schema-task-graph.ts`** (~120 lines)
- Drizzle table definitions for: `workerNodes`, `agentProfiles`, `agentInstances`, `taskGraphs`, `taskDefinitions`, `taskEdges`, `taskRuns`, `workerLeases`
- Follow existing patterns from `schema-collaboration.ts`
- `agent_profiles` and `agent_instances` are self-contained (Phase 2 may define them in parallel; CREATE IF NOT EXISTS in migration)

**File: `migrations/0002_task_graph_fleet.sql`**
- SQL DDL for all tables with CHECK constraints, FKs, indexes

Update `packages/control-plane/src/db/index.ts` to re-export `schema-task-graph.ts`.

### Layer 3: DAG Validation (`packages/shared/src/`)

**File: `dag-validation.ts`** (~100 lines)
- `detectCycles(edges)` - returns cycle path or null
- `topologicalSort(definitions, edges)` - returns ordered IDs or throws on cycle
- `validateTaskGraph(definitions, edges)` - combined validation (cycles, orphans, fork/join integrity)
- Pure functions, no DB dependency

**File: `dag-validation.test.ts`** (~150 lines)
- Cycle detection tests (no cycle, simple cycle, diamond, self-loop)
- Topological sort tests (linear chain, diamond, parallel)
- Fork/join validation tests

### Layer 4: Stores (`packages/control-plane/src/collaboration/`)

**File: `task-graph-store.ts`** (~200 lines)
- `TaskGraphStore` class (constructor: db, logger)
- CRUD: `createGraph()`, `getGraph()`, `listGraphs()`, `deleteGraph()`
- Definitions: `addDefinition()`, `getDefinitions()`, `getDefinition()`
- Edges: `addEdge()`, `getEdges()`, `removeEdge()`
- Resolution: `getReadyTasks(graphId)` - returns tasks whose blocking deps are completed

**File: `worker-node-store.ts`** (~100 lines)
- `WorkerNodeStore` class
- `registerNode()`, `getNode()`, `listNodes()`, `updateHeartbeat()`, `setStatus()`

**File: `task-run-store.ts`** (~150 lines)
- `TaskRunStore` class
- `createRun()`, `getRun()`, `listRuns()`, `updateStatus()`
- `getRunsByGraph(graphId)`

**File: `worker-lease-store.ts`** (~120 lines)
- `WorkerLeaseStore` class
- `claimLease(taskRunId, workerId, agentInstanceId, durationMs)` - atomic INSERT with conflict check
- `renewLease(taskRunId, durationMs)` - UPDATE expires_at
- `releaseLease(taskRunId)`
- `getExpiredLeases()` - leases past expiry
- `getLease(taskRunId)`

### Layer 5: BullMQ Executor (`packages/control-plane/src/scheduler/`)

**File: `task-graph-executor.ts`** (~100 lines)
- `BullMQTaskExecutor` implements `TaskExecutor`
- Wraps existing BullMQ queue for task graph submissions
- Maps `TaskRun` to BullMQ job data

### Layer 6: Fastify Routes (`packages/control-plane/src/api/routes/`)

**File: `task-graphs.ts`** (~200 lines)
- `GET /api/task-graphs` - list graphs
- `POST /api/task-graphs` - create graph
- `GET /api/task-graphs/:id` - get graph with definitions and edges
- `DELETE /api/task-graphs/:id` - delete graph
- `POST /api/task-graphs/:id/definitions` - add task definition
- `POST /api/task-graphs/:id/edges` - add edge (validates DAG)
- `POST /api/task-graphs/:id/validate` - validate full DAG
- `GET /api/task-graphs/:id/ready` - get ready-to-execute tasks

**File: `task-runs.ts`** (~150 lines)
- `POST /api/task-runs` - create run from definition
- `GET /api/task-runs/:id` - get run
- `PATCH /api/task-runs/:id` - update status
- `POST /api/task-runs/:id/claim` - claim lease
- `POST /api/task-runs/:id/heartbeat` - renew lease

**File: `worker-nodes.ts`** (~120 lines)
- `POST /api/fleet/nodes` - register node
- `GET /api/fleet/nodes` - list nodes
- `GET /api/fleet/nodes/:id` - get node
- `POST /api/fleet/nodes/:id/heartbeat` - heartbeat
- `GET /api/fleet/overview` - aggregate fleet status

### Layer 7: Route Registration

Update `packages/control-plane/src/api/routes/` index or server registration to include the new route plugins.

## Execution Order

1. Shared types (no deps)
2. DB schema + migration (depends on types for reference)
3. DAG validation (pure, no DB)
4. Stores (depends on schema)
5. BullMQ executor (depends on types + stores)
6. Routes (depends on stores)
7. Build + lint verification

## Test Strategy

- DAG validation: 10+ unit tests (cycles, topo sort, fork/join)
- Stores: tested via route integration tests
- Routes: basic request/response tests following existing patterns in `spaces.ts`
- Worker lease: dedicated tests for claim/renew/expire protocol
