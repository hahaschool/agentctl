# Multi-Agent Communication Implementation Plan (Phase 2)

**Date**: 2026-03-12
**Branch**: `feat/collaboration-phase2-agent-bus`
**Design**: `docs/plans/2026-03-12-multi-agent-collaboration-design.md` (Phase 2 section)

## Scope

Phase 2 builds on the Phase 1 foundation (spaces, threads, events) to add:
1. Agent identity tables (agent_profiles, agent_instances)
2. Subscription filters on space_members
3. Approval gates + decisions tables
4. AgentMessage shared types
5. Outbox publisher service (polls unpublished events, marks published)
6. NATS JetStream integration (interface + mock for CI)
7. Approval gate store + routes
8. WebSocket gateway for event fanout
9. Agent profile/instance store + routes

## Implementation Steps

### Step 1: DB Migration (0002)
File: `packages/control-plane/src/db/migrations/0002_agent_bus_approval_gates.sql`

- Add `subscription_filter JSONB DEFAULT '{}'` to `space_members`
- Create `agent_profiles` table
- Create `agent_instances` table
- Create `approval_gates` table
- Create `approval_decisions` table

### Step 2: Drizzle Schema Extension
File: `packages/control-plane/src/db/schema-collaboration.ts`

- Add `subscriptionFilter` column to `spaceMembers`
- Add `agentProfiles` table definition
- Add `agentInstances` table definition
- Add `approvalGates` table definition
- Add `approvalDecisions` table definition
- Export new tables from `packages/control-plane/src/db/index.ts`

### Step 3: Shared Types
Files:
- `packages/shared/src/types/agent-message.ts` — AgentMessage, AgentPayload, SubscriptionFilter
- `packages/shared/src/types/approval.ts` — ApprovalGate, ApprovalDecision types
- `packages/shared/src/types/agent-identity.ts` — AgentProfile, AgentInstance types
- Update `packages/shared/src/types/collaboration.ts` — extend SpaceMember with subscriptionFilter
- Update `packages/shared/src/types/index.ts` — re-export new types

### Step 4: NATS Transport Interface
Files:
- `packages/control-plane/src/collaboration/event-bus.ts` — EventBus interface
- `packages/control-plane/src/collaboration/nats-event-bus.ts` — NATS JetStream implementation
- `packages/control-plane/src/collaboration/mock-event-bus.ts` — In-memory mock for tests/CI

### Step 5: Outbox Publisher Service
File: `packages/control-plane/src/collaboration/outbox-publisher.ts`

- Polls space_events WHERE published = false
- Publishes to EventBus
- Marks published = true on success
- Configurable poll interval, batch size
- Graceful start/stop lifecycle

### Step 6: Agent Profile/Instance Store
File: `packages/control-plane/src/collaboration/agent-profile-store.ts`

- CRUD for agent_profiles and agent_instances
- Follows SpaceStore pattern (constructor takes db + logger)

### Step 7: Approval Gate Store
File: `packages/control-plane/src/collaboration/approval-store.ts`

- Create gate, get gate, list gates by thread
- Add decision, check if gate resolved
- Auto-resolve gate status based on decisions vs requiredCount

### Step 8: Space Store Extension
Update: `packages/control-plane/src/collaboration/space-store.ts`

- addMember now accepts subscriptionFilter
- updateMemberFilter method
- getMembers returns subscriptionFilter

### Step 9: WebSocket Event Gateway
File: `packages/control-plane/src/collaboration/event-gateway.ts`

- Fastify WebSocket plugin route at `/ws/spaces/:spaceId/events`
- Subscribes to EventBus for space events
- Filters events per client's subscription filter
- Sends JSON frames to connected clients

### Step 10: API Routes
Files:
- `packages/control-plane/src/api/routes/agent-profiles.ts` — CRUD for profiles + instances
- `packages/control-plane/src/api/routes/approvals.ts` — Gate CRUD + decision submission
- Update `packages/control-plane/src/api/routes/spaces.ts` — subscription filter on add-member
- Register new routes in `packages/control-plane/src/api/server.ts`

### Step 11: Tests
- `outbox-publisher.test.ts` — polling, marking published, error handling
- `approval-store.test.ts` — gate lifecycle, decision counting
- `agent-profile-store.test.ts` — CRUD operations
- `event-gateway.test.ts` — WebSocket fanout with filters
- Route tests for new endpoints

## File Size Targets

All new files should be under 400 lines. The largest will be the outbox publisher (~250 lines) and the routes (~300 lines each).

## Test Strategy

- Mock the database at the boundary (same pattern as existing stores)
- NATS uses MockEventBus in all tests
- No real Postgres or NATS connections needed
- Focus on behavior: outbox publishes/marks, approval gate resolves, filters work

## Dependencies

- No new npm packages needed for the core implementation
- NATS client (`nats`) is a runtime dependency, imported dynamically
- The MockEventBus allows all code to work without NATS installed
