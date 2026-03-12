# Multi-Agent Collaboration Phase 1: Spaces + Threads + Messages - Implementation Plan

> For agentic workers: REQUIRED: use `superpowers:subagent-driven-development` (if subagents are available) or `superpowers:executing-plans` to execute this plan. Steps use checkbox syntax for progress tracking.

**Goal:** ship the first production-safe slice of collaboration in AgentCTL:
- durable `Space` / `Thread` / `SpaceEvent` primitives in PostgreSQL via Drizzle
- Fastify routes for CRUD + append-only events
- minimal web UI for browsing Spaces and posting thread messages
- an idempotent bridge from legacy sessions into solo Spaces

**Phase 1 scope:** this phase is intentionally single-control-plane and mostly request/response driven. It does **not** include multi-agent bus fanout, NATS, WebSocket delivery, approval gates, or task graph orchestration. Those land in later phases after the core collaboration model is stable.

**Tech stack:** Drizzle ORM, Fastify, React Query v5, Next.js 16, React 19, Vitest, pnpm workspaces

**Design doc:** `docs/plans/2026-03-12-multi-agent-collaboration-design.md`

---

## Review Corrections Applied

The previous draft was directionally right but would have generated broken code in this repo. This revised plan fixes the main issues up front:

1. **Event sequencing is now atomic.**
   The old `MAX(sequence_num) + 1` raw SQL approach races under concurrency. Phase 1 now adds `threads.last_event_sequence` and increments it inside a transaction before inserting `space_events`.

2. **The plan now matches the repo's control-plane patterns.**
   Routes use Fastify `prefix` registration, stores use Drizzle's existing `returning()` / `returning({ id })` style, delete endpoints return JSON like the rest of the repo, and tests use the same thenable query-builder mock pattern already used in `resolve-account.test.ts` and `accounts.test.ts`.

3. **The web work now matches the repo's frontend architecture.**
   New collaboration endpoints are added to `packages/web/src/lib/api.ts` and `packages/web/src/lib/queries.ts`, and UI lives in view components plus App Router shells. The old draft's ad hoc fetch helpers and local query-key constants were inconsistent with the existing codebase.

4. **Legacy session bridging is now durable.**
   The old `SessionBridge` would create duplicate Spaces every time it ran. Phase 1 now includes a `session_space_links` table so bridging is idempotent.

5. **Route handlers cover missing edge cases.**
   Empty JSON bodies, invalid UUIDs, thread/space mismatches, malformed payloads, duplicate idempotency keys, and missing resources are all handled explicitly.

6. **Verification is aligned with the monorepo.**
   The old draft hard-coded `git push origin main` and skipped web tests. This plan verifies shared, control-plane, and web packages separately, and it keeps push/merge decisions out of the implementation checklist.

---

## Success Criteria

Phase 1 is complete when all of the following are true:

- `packages/shared` exports collaboration types and validators with no TypeScript errors.
- `packages/control-plane` contains durable collaboration tables, migrations, stores, and Fastify routes.
- app routes under `/api/spaces/*` support spaces, members, threads, and events.
- `packages/web` can list Spaces, open a Space, create a thread, and post a message.
- legacy session -> Space linking is idempotent and persisted.
- targeted tests pass for shared types, control-plane stores/routes, and web views.
- full package builds and `pnpm check` pass on a clean tree.

---

## Chunk 1: Shared Types, Schema, and Migration

### Task 1: Add shared collaboration types and validators

**Files:**
- Create: `packages/shared/src/types/collaboration.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: create the type module**

```typescript
// packages/shared/src/types/collaboration.ts

export const SPACE_TYPES = ['collaboration', 'solo', 'fleet-overview'] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const SPACE_VISIBILITIES = ['private', 'team', 'public'] as const;
export type SpaceVisibility = (typeof SPACE_VISIBILITIES)[number];

export const SPACE_MEMBER_TYPES = ['human', 'agent'] as const;
export type SpaceMemberType = (typeof SPACE_MEMBER_TYPES)[number];

export const SPACE_MEMBER_ROLES = ['owner', 'member', 'observer'] as const;
export type SpaceMemberRole = (typeof SPACE_MEMBER_ROLES)[number];

export const THREAD_TYPES = ['discussion', 'execution', 'review', 'approval'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export const SPACE_EVENT_TYPES = ['message', 'artifact', 'control', 'task-state', 'approval'] as const;
export type SpaceEventType = (typeof SPACE_EVENT_TYPES)[number];

export const EVENT_SENDER_TYPES = ['human', 'agent', 'system'] as const;
export type EventSenderType = (typeof EVENT_SENDER_TYPES)[number];

export const EVENT_VISIBILITIES = ['public', 'internal', 'silent'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export type Space = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: SpaceType;
  readonly visibility: SpaceVisibility;
  readonly createdBy: string;
  readonly createdAt: string;
};

export type SpaceMember = {
  readonly spaceId: string;
  readonly memberType: SpaceMemberType;
  readonly memberId: string;
  readonly role: SpaceMemberRole;
};

export type Thread = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string | null;
  readonly type: ThreadType;
  readonly createdAt: string;
};

export type SpaceEvent = {
  readonly id: string;
  readonly spaceId: string;
  readonly threadId: string;
  readonly sequenceNum: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly type: SpaceEventType;
  readonly senderType: EventSenderType;
  readonly senderId: string;
  readonly payload: Record<string, unknown>;
  readonly visibility: EventVisibility;
  readonly createdAt: string;
};

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function isSpaceType(value: string): value is SpaceType {
  return includes(SPACE_TYPES, value);
}

export function isSpaceVisibility(value: string): value is SpaceVisibility {
  return includes(SPACE_VISIBILITIES, value);
}

export function isSpaceMemberType(value: string): value is SpaceMemberType {
  return includes(SPACE_MEMBER_TYPES, value);
}

export function isSpaceMemberRole(value: string): value is SpaceMemberRole {
  return includes(SPACE_MEMBER_ROLES, value);
}

export function isThreadType(value: string): value is ThreadType {
  return includes(THREAD_TYPES, value);
}

export function isSpaceEventType(value: string): value is SpaceEventType {
  return includes(SPACE_EVENT_TYPES, value);
}

export function isEventSenderType(value: string): value is EventSenderType {
  return includes(EVENT_SENDER_TYPES, value);
}

export function isEventVisibility(value: string): value is EventVisibility {
  return includes(EVENT_VISIBILITIES, value);
}
```

- [ ] **Step 2: re-export from `packages/shared/src/types/index.ts`**

```typescript
export type {
  EventSenderType,
  EventVisibility,
  Space,
  SpaceEvent,
  SpaceEventType,
  SpaceMember,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  Thread,
  ThreadType,
} from './collaboration.js';
export {
  EVENT_SENDER_TYPES,
  EVENT_VISIBILITIES,
  isEventSenderType,
  isEventVisibility,
  isSpaceEventType,
  isSpaceMemberRole,
  isSpaceMemberType,
  isSpaceType,
  isSpaceVisibility,
  isThreadType,
  SPACE_EVENT_TYPES,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_TYPES,
  SPACE_TYPES,
  SPACE_VISIBILITIES,
  THREAD_TYPES,
} from './collaboration.js';
```

- [ ] **Step 3: verify shared package builds**

Run:

```bash
cd packages/shared
pnpm build
```

- [ ] **Step 4: commit**

```bash
git add packages/shared/src/types/collaboration.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add collaboration types and validators"
```

### Task 2: Add Drizzle schema for spaces, members, threads, events, and session links

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`
- Create: `packages/control-plane/src/db/schema-collaboration.test.ts`

**Important repo decision:** Phase 1 keeps enum validation in shared validators and route handlers instead of introducing PostgreSQL enums or DB `CHECK` constraints. That keeps the migration exactly aligned with the Drizzle schema and matches the rest of the current control-plane tables, which mostly use `text` columns with app-layer validation.

- [ ] **Step 1: add a schema export test**

```typescript
// packages/control-plane/src/db/schema-collaboration.test.ts
import { describe, expect, it } from 'vitest';

import { sessionSpaceLinks, spaceEvents, spaceMembers, spaces, threads } from './schema.js';

describe('collaboration schema exports', () => {
  it('exports spaces columns', () => {
    expect(spaces.id).toBeDefined();
    expect(spaces.name).toBeDefined();
    expect(spaces.description).toBeDefined();
    expect(spaces.type).toBeDefined();
    expect(spaces.visibility).toBeDefined();
    expect(spaces.createdBy).toBeDefined();
    expect(spaces.createdAt).toBeDefined();
  });

  it('exports thread sequencing columns', () => {
    expect(threads.id).toBeDefined();
    expect(threads.spaceId).toBeDefined();
    expect(threads.lastEventSequence).toBeDefined();
    expect(threads.createdAt).toBeDefined();
  });

  it('exports space event columns', () => {
    expect(spaceEvents.id).toBeDefined();
    expect(spaceEvents.threadId).toBeDefined();
    expect(spaceEvents.sequenceNum).toBeDefined();
    expect(spaceEvents.idempotencyKey).toBeDefined();
    expect(spaceEvents.published).toBeDefined();
  });

  it('exports session link columns', () => {
    expect(sessionSpaceLinks.sessionKind).toBeDefined();
    expect(sessionSpaceLinks.sessionId).toBeDefined();
    expect(sessionSpaceLinks.spaceId).toBeDefined();
    expect(sessionSpaceLinks.threadId).toBeDefined();
  });
});
```

- [ ] **Step 2: update `schema.ts`**

Add `primaryKey` to the `drizzle-orm/pg-core` import and append:

```typescript
// packages/control-plane/src/db/schema.ts
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    type: text('type').notNull(),
    visibility: text('visibility').notNull().default('team'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_spaces_created_at').on(table.createdAt)],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    memberType: text('member_type').notNull(),
    memberId: text('member_id').notNull(),
    role: text('role').notNull().default('member'),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.memberType, table.memberId] }),
    index('idx_space_members_member_id').on(table.memberId),
  ],
);

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title'),
    lastEventSequence: integer('last_event_sequence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_threads_space_created').on(table.spaceId, table.createdAt)],
);

export const spaceEvents = pgTable(
  'space_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    sequenceNum: integer('sequence_num').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    correlationId: text('correlation_id').notNull(),
    type: text('type').notNull(),
    senderType: text('sender_type').notNull(),
    senderId: text('sender_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    visibility: text('visibility').notNull().default('public'),
    published: boolean('published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_space_events_thread_seq').on(table.threadId, table.sequenceNum),
    index('idx_space_events_published_created').on(table.published, table.createdAt),
  ],
);

export const sessionSpaceLinks = pgTable(
  'session_space_links',
  {
    sessionKind: text('session_kind').notNull(),
    sessionId: text('session_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' })
      .unique(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' })
      .unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionKind, table.sessionId] })],
);
```

- [ ] **Step 3: verify schema test**

Run:

```bash
cd packages/control-plane
pnpm vitest run src/db/schema-collaboration.test.ts
```

- [ ] **Step 4: commit**

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/src/db/schema-collaboration.test.ts
git commit -m "feat(cp): add collaboration schema tables"
```

### Task 3: Write a migration that matches the Drizzle schema exactly

**Files:**
- Create: `packages/control-plane/drizzle/0013_add_collaboration_spaces.sql`
- Update if needed: `packages/control-plane/drizzle/meta/_journal.json`

- [ ] **Step 1: author the SQL migration**

```sql
-- 0013_add_collaboration_spaces.sql
-- Core collaboration tables for Phase 1.

CREATE TABLE IF NOT EXISTS "spaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "type" text NOT NULL,
  "visibility" text NOT NULL DEFAULT 'team',
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_spaces_created_at"
  ON "spaces"("created_at");

CREATE TABLE IF NOT EXISTS "space_members" (
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "member_type" text NOT NULL,
  "member_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  PRIMARY KEY ("space_id", "member_type", "member_id")
);

CREATE INDEX IF NOT EXISTS "idx_space_members_member_id"
  ON "space_members"("member_id");

CREATE TABLE IF NOT EXISTS "threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text,
  "last_event_sequence" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_threads_space_created"
  ON "threads"("space_id", "created_at");

CREATE TABLE IF NOT EXISTS "space_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "thread_id" uuid NOT NULL REFERENCES "threads"("id") ON DELETE CASCADE,
  "sequence_num" integer NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "correlation_id" text NOT NULL,
  "type" text NOT NULL,
  "sender_type" text NOT NULL,
  "sender_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "visibility" text NOT NULL DEFAULT 'public',
  "published" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("thread_id", "sequence_num")
);

CREATE INDEX IF NOT EXISTS "idx_space_events_thread_seq"
  ON "space_events"("thread_id", "sequence_num");

CREATE INDEX IF NOT EXISTS "idx_space_events_published_created"
  ON "space_events"("published", "created_at");

CREATE TABLE IF NOT EXISTS "session_space_links" (
  "session_kind" text NOT NULL,
  "session_id" text NOT NULL,
  "space_id" uuid NOT NULL UNIQUE REFERENCES "spaces"("id") ON DELETE CASCADE,
  "thread_id" uuid NOT NULL UNIQUE REFERENCES "threads"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("session_kind", "session_id")
);
```

- [ ] **Step 2: make sure the migration is actually discoverable**

Run one of these, depending on how the team wants to manage Drizzle metadata:

```bash
cd packages/control-plane
pnpm db:generate
```

or, if migrations stay hand-authored, update `drizzle/meta/_journal.json` in the same commit. Do not leave a valid SQL file that the migration runner cannot see.

- [ ] **Step 3: verify the SQL against a disposable database**

```bash
cd packages/control-plane
psql "$DATABASE_URL" -f drizzle/0013_add_collaboration_spaces.sql
```

- [ ] **Step 4: commit**

```bash
git add packages/control-plane/drizzle/0013_add_collaboration_spaces.sql packages/control-plane/drizzle/meta/_journal.json
git commit -m "feat(cp): add collaboration migration"
```

---

## Chunk 2: Control Plane Stores and Routes

### Task 4: Implement `SpaceStore`, `ThreadStore`, and `MemberStore`

**Files:**
- Create: `packages/control-plane/src/collaboration/space-store.ts`
- Create: `packages/control-plane/src/collaboration/thread-store.ts`
- Create: `packages/control-plane/src/collaboration/member-store.ts`
- Create: `packages/control-plane/src/collaboration/space-store.test.ts`
- Create: `packages/control-plane/src/collaboration/thread-store.test.ts`
- Create: `packages/control-plane/src/collaboration/member-store.test.ts`

**Testing guidance:** for basic store tests, reuse the thenable Drizzle mock pattern already present in `packages/control-plane/src/utils/resolve-account.test.ts`. Do not use shallow `{ insert: fn(), select: fn() }` mocks that cannot behave like a chained query builder.

- [ ] **Step 1: implement `SpaceStore`**

```typescript
// packages/control-plane/src/collaboration/space-store.ts
import { ControlPlaneError } from '@agentctl/shared';
import { desc, eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { spaces } from '../db/schema.js';

export type SpaceRecord = typeof spaces.$inferSelect;

export type CreateSpaceInput = {
  readonly name: string;
  readonly type: string;
  readonly visibility: string;
  readonly description?: string;
  readonly createdBy: string;
};

export type SpaceStore = {
  createSpace(input: CreateSpaceInput): Promise<SpaceRecord>;
  getSpace(id: string): Promise<SpaceRecord | null>;
  listSpaces(): Promise<SpaceRecord[]>;
  deleteSpace(id: string): Promise<boolean>;
};

export function createSpaceStore(db: Database): SpaceStore {
  return {
    async createSpace(input) {
      const rows = await db
        .insert(spaces)
        .values({
          name: input.name,
          description: input.description ?? '',
          type: input.type,
          visibility: input.visibility,
          createdBy: input.createdBy,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new ControlPlaneError('SPACE_CREATE_FAILED', 'Failed to create space');
      }
      return row;
    },

    async getSpace(id) {
      const rows = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listSpaces() {
      return db.select().from(spaces).orderBy(desc(spaces.createdAt));
    },

    async deleteSpace(id) {
      const rows = await db.delete(spaces).where(eq(spaces.id, id)).returning({ id: spaces.id });
      return rows.length > 0;
    },
  };
}
```

- [ ] **Step 2: implement `ThreadStore`**

```typescript
// packages/control-plane/src/collaboration/thread-store.ts
import { ControlPlaneError } from '@agentctl/shared';
import { asc, eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { threads } from '../db/schema.js';

export type ThreadRecord = typeof threads.$inferSelect;

export type CreateThreadInput = {
  readonly spaceId: string;
  readonly type: string;
  readonly title?: string;
};

export type ThreadStore = {
  createThread(input: CreateThreadInput): Promise<ThreadRecord>;
  getThread(id: string): Promise<ThreadRecord | null>;
  listThreadsBySpace(spaceId: string): Promise<ThreadRecord[]>;
};

export function createThreadStore(db: Database): ThreadStore {
  return {
    async createThread(input) {
      const rows = await db
        .insert(threads)
        .values({
          spaceId: input.spaceId,
          type: input.type,
          title: input.title ?? null,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new ControlPlaneError('THREAD_CREATE_FAILED', 'Failed to create thread');
      }
      return row;
    },

    async getThread(id) {
      const rows = await db.select().from(threads).where(eq(threads.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listThreadsBySpace(spaceId) {
      return db
        .select()
        .from(threads)
        .where(eq(threads.spaceId, spaceId))
        .orderBy(asc(threads.createdAt));
    },
  };
}
```

- [ ] **Step 3: implement `MemberStore`**

```typescript
// packages/control-plane/src/collaboration/member-store.ts
import { ControlPlaneError } from '@agentctl/shared';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { spaceMembers } from '../db/schema.js';

export type MemberRecord = typeof spaceMembers.$inferSelect;

export type AddMemberInput = {
  readonly spaceId: string;
  readonly memberType: string;
  readonly memberId: string;
  readonly role: string;
};

export type MemberStore = {
  addMember(input: AddMemberInput): Promise<MemberRecord>;
  listMembers(spaceId: string): Promise<MemberRecord[]>;
  removeMember(spaceId: string, memberType: string, memberId: string): Promise<boolean>;
};

export function createMemberStore(db: Database): MemberStore {
  return {
    async addMember(input) {
      const inserted = await db
        .insert(spaceMembers)
        .values(input)
        .onConflictDoNothing()
        .returning();

      if (inserted[0]) {
        return inserted[0];
      }

      const existing = await db
        .select()
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, input.spaceId),
            eq(spaceMembers.memberType, input.memberType),
            eq(spaceMembers.memberId, input.memberId),
          ),
        )
        .limit(1);

      const row = existing[0];
      if (!row) {
        throw new ControlPlaneError('SPACE_MEMBER_UPSERT_FAILED', 'Failed to read existing space member after conflict');
      }
      return row;
    },

    async listMembers(spaceId) {
      return db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));
    },

    async removeMember(spaceId, memberType, memberId) {
      const rows = await db
        .delete(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, spaceId),
            eq(spaceMembers.memberType, memberType),
            eq(spaceMembers.memberId, memberId),
          ),
        )
        .returning({
          spaceId: spaceMembers.spaceId,
        });

      return rows.length > 0;
    },
  };
}
```

- [ ] **Step 4: add store tests**

At minimum:
- `space-store.test.ts`: create, get, list, delete
- `thread-store.test.ts`: create, get, list-by-space
- `member-store.test.ts`: add member, duplicate add returns existing member, remove member

- [ ] **Step 5: verify and commit**

```bash
cd packages/control-plane
pnpm vitest run \
  src/collaboration/space-store.test.ts \
  src/collaboration/thread-store.test.ts \
  src/collaboration/member-store.test.ts

git add packages/control-plane/src/collaboration/space-store.ts \
  packages/control-plane/src/collaboration/thread-store.ts \
  packages/control-plane/src/collaboration/member-store.ts \
  packages/control-plane/src/collaboration/space-store.test.ts \
  packages/control-plane/src/collaboration/thread-store.test.ts \
  packages/control-plane/src/collaboration/member-store.test.ts
git commit -m "feat(cp): add collaboration stores"
```

### Task 5: Implement `EventStore` with transactional sequence allocation

**Files:**
- Create: `packages/control-plane/src/collaboration/event-store.ts`
- Create: `packages/control-plane/src/collaboration/event-store.test.ts`

**Critical rule:** sequence numbers must be **monotonic and unique per thread**. They do **not** need to be gap-free. The API contract and tests must assert monotonic uniqueness, not contiguity.

- [ ] **Step 1: implement the store**

```typescript
// packages/control-plane/src/collaboration/event-store.ts
import { ControlPlaneError } from '@agentctl/shared';
import { and, asc, eq, gt, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { spaceEvents, threads } from '../db/schema.js';

export type SpaceEventRecord = typeof spaceEvents.$inferSelect;

export type AppendEventInput = {
  readonly spaceId: string;
  readonly threadId: string;
  readonly type: string;
  readonly senderType: string;
  readonly senderId: string;
  readonly payload: Record<string, unknown>;
  readonly visibility: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
};

export type EventStore = {
  appendEvent(input: AppendEventInput): Promise<SpaceEventRecord>;
  listEvents(threadId: string, opts?: { afterSequence?: number; limit?: number }): Promise<SpaceEventRecord[]>;
  getUnpublished(limit?: number): Promise<SpaceEventRecord[]>;
  markPublished(eventId: string): Promise<void>;
};

function isUniqueViolation(error: unknown): error is { code: string } {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505';
}

export function createEventStore(db: Database): EventStore {
  return {
    async appendEvent(input) {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(spaceEvents)
          .where(eq(spaceEvents.idempotencyKey, input.idempotencyKey))
          .limit(1);

        if (existing[0]) {
          return existing[0];
        }

        const nextSequenceRows = await tx
          .update(threads)
          .set({
            lastEventSequence: sql`${threads.lastEventSequence} + 1`,
          })
          .where(and(eq(threads.id, input.threadId), eq(threads.spaceId, input.spaceId)))
          .returning({
            sequenceNum: threads.lastEventSequence,
          });

        const nextSequence = nextSequenceRows[0]?.sequenceNum;
        if (nextSequence === undefined) {
          throw new ControlPlaneError(
            'THREAD_NOT_FOUND',
            `Thread '${input.threadId}' was not found in space '${input.spaceId}'`,
          );
        }

        try {
          const rows = await tx
            .insert(spaceEvents)
            .values({
              spaceId: input.spaceId,
              threadId: input.threadId,
              sequenceNum: nextSequence,
              idempotencyKey: input.idempotencyKey,
              correlationId: input.correlationId,
              type: input.type,
              senderType: input.senderType,
              senderId: input.senderId,
              payload: input.payload,
              visibility: input.visibility,
            })
            .returning();

          const row = rows[0];
          if (!row) {
            throw new ControlPlaneError('SPACE_EVENT_CREATE_FAILED', 'Failed to append space event');
          }
          return row;
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          const duplicate = await tx
            .select()
            .from(spaceEvents)
            .where(eq(spaceEvents.idempotencyKey, input.idempotencyKey))
            .limit(1);

          if (duplicate[0]) {
            return duplicate[0];
          }

          throw error;
        }
      });
    },

    async listEvents(threadId, opts) {
      const afterSequence = opts?.afterSequence ?? 0;
      const limit = Math.min(opts?.limit ?? 100, 500);

      return db
        .select()
        .from(spaceEvents)
        .where(and(eq(spaceEvents.threadId, threadId), gt(spaceEvents.sequenceNum, afterSequence)))
        .orderBy(asc(spaceEvents.sequenceNum))
        .limit(limit);
    },

    async getUnpublished(limit = 100) {
      return db
        .select()
        .from(spaceEvents)
        .where(eq(spaceEvents.published, false))
        .orderBy(asc(spaceEvents.createdAt))
        .limit(limit);
    },

    async markPublished(eventId) {
      await db.update(spaceEvents).set({ published: true }).where(eq(spaceEvents.id, eventId));
    },
  };
}
```

- [ ] **Step 2: write realistic tests**

`event-store.test.ts` should use a purpose-built fake with:
- `transaction(cb)` that passes a mutable fake transaction object
- `select` returning existing events for duplicate idempotency tests
- `update(threads).set(...).where(...).returning(...)` returning `{ sequenceNum: 1 }`
- `insert(spaceEvents).values(...).returning()` returning a saved event

Minimum cases:
- append event allocates sequence `1`
- duplicate idempotency key returns the existing row without a second insert
- missing thread raises `THREAD_NOT_FOUND`
- `listEvents` respects `afterSequence` and limit

- [ ] **Step 3: verify and commit**

```bash
cd packages/control-plane
pnpm vitest run src/collaboration/event-store.test.ts

git add packages/control-plane/src/collaboration/event-store.ts packages/control-plane/src/collaboration/event-store.test.ts
git commit -m "feat(cp): add transactional event store"
```

### Task 6: Add `SessionSpaceLinkStore` and idempotent `SessionBridge`

**Files:**
- Create: `packages/control-plane/src/collaboration/session-space-link-store.ts`
- Create: `packages/control-plane/src/collaboration/session-bridge.ts`
- Create: `packages/control-plane/src/collaboration/session-bridge.test.ts`

- [ ] **Step 1: implement `SessionSpaceLinkStore`**

```typescript
// packages/control-plane/src/collaboration/session-space-link-store.ts
import { ControlPlaneError } from '@agentctl/shared';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { sessionSpaceLinks } from '../db/schema.js';

export type SessionKind = 'rc' | 'managed';
export type SessionSpaceLinkRecord = typeof sessionSpaceLinks.$inferSelect;

export type SessionSpaceLinkStore = {
  get(sessionKind: SessionKind, sessionId: string): Promise<SessionSpaceLinkRecord | null>;
  create(input: {
    sessionKind: SessionKind;
    sessionId: string;
    spaceId: string;
    threadId: string;
  }): Promise<SessionSpaceLinkRecord>;
};

export function createSessionSpaceLinkStore(db: Database): SessionSpaceLinkStore {
  async function getLink(
    sessionKind: SessionKind,
    sessionId: string,
  ): Promise<SessionSpaceLinkRecord | null> {
    const rows = await db
      .select()
      .from(sessionSpaceLinks)
      .where(
        and(
          eq(sessionSpaceLinks.sessionKind, sessionKind),
          eq(sessionSpaceLinks.sessionId, sessionId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    async get(sessionKind, sessionId) {
      return getLink(sessionKind, sessionId);
    },

    async create(input) {
      const inserted = await db.insert(sessionSpaceLinks).values(input).onConflictDoNothing().returning();
      if (inserted[0]) {
        return inserted[0];
      }

      const existing = await getLink(input.sessionKind, input.sessionId);
      if (!existing) {
        throw new ControlPlaneError('SESSION_SPACE_LINK_CREATE_FAILED', 'Failed to read existing session-space link after conflict');
      }
      return existing;
    },
  };
}
```

- [ ] **Step 2: implement an idempotent bridge**

```typescript
// packages/control-plane/src/collaboration/session-bridge.ts
import type { MemberStore } from './member-store.js';
import type { SessionKind, SessionSpaceLinkStore } from './session-space-link-store.js';
import type { SpaceStore } from './space-store.js';
import type { ThreadStore } from './thread-store.js';

export type EnsureSessionSpaceInput = {
  readonly sessionKind: SessionKind;
  readonly sessionId: string;
  readonly projectPath: string;
  readonly agentId?: string;
};

export function createSessionBridge(
  spaceStore: SpaceStore,
  threadStore: ThreadStore,
  memberStore: MemberStore,
  linkStore: SessionSpaceLinkStore,
) {
  return {
    async ensureSessionSpace(input: EnsureSessionSpaceInput) {
      const existingLink = await linkStore.get(input.sessionKind, input.sessionId);
      if (existingLink) {
        return existingLink;
      }

      const space = await spaceStore.createSpace({
        name: `Session ${input.sessionId.slice(0, 8)}`,
        description: `Legacy ${input.sessionKind} session bridged from ${input.projectPath}`,
        type: 'solo',
        visibility: 'private',
        createdBy: 'system',
      });

      const thread = await threadStore.createThread({
        spaceId: space.id,
        type: 'execution',
        title: 'Main',
      });

      if (input.agentId) {
        await memberStore.addMember({
          spaceId: space.id,
          memberType: 'agent',
          memberId: input.agentId,
          role: 'member',
        });
      }

      return linkStore.create({
        sessionKind: input.sessionKind,
        sessionId: input.sessionId,
        spaceId: space.id,
        threadId: thread.id,
      });
    },
  };
}
```

- [ ] **Step 3: test the duplication case**

`session-bridge.test.ts` must verify:
- first call creates a space, thread, and link
- second call with the same `sessionKind + sessionId` returns the stored link and does **not** create another space

- [ ] **Step 4: verify and commit**

```bash
cd packages/control-plane
pnpm vitest run src/collaboration/session-bridge.test.ts

git add packages/control-plane/src/collaboration/session-space-link-store.ts \
  packages/control-plane/src/collaboration/session-bridge.ts \
  packages/control-plane/src/collaboration/session-bridge.test.ts
git commit -m "feat(cp): add idempotent session-to-space bridge"
```

### Task 7: Add Fastify collaboration routes

**Files:**
- Create: `packages/control-plane/src/api/routes/spaces.ts`
- Create: `packages/control-plane/src/api/routes/spaces.test.ts`

**Route design rules for this repo:**
- register the plugin with `prefix: '/api/spaces'`
- inside the plugin use relative paths like `'/'`, `'/:spaceId'`, `'/:spaceId/threads'`
- return `400` / `404` / `409` directly from the route handler for validation and lookup errors
- reserve thrown `ControlPlaneError` for store-level failures that should flow through the global server error handler

- [ ] **Step 1: implement the plugin**

```typescript
// packages/control-plane/src/api/routes/spaces.ts
import * as crypto from 'node:crypto';

import {
  isEventSenderType,
  isEventVisibility,
  isSpaceEventType,
  isSpaceMemberRole,
  isSpaceMemberType,
  isSpaceType,
  isSpaceVisibility,
  isThreadType,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { EventStore } from '../../collaboration/event-store.js';
import type { MemberStore } from '../../collaboration/member-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';
import type { ThreadStore } from '../../collaboration/thread-store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SpaceRoutesOptions = {
  spaceStore: SpaceStore;
  threadStore: ThreadStore;
  eventStore: EventStore;
  memberStore: MemberStore;
};

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const spaceRoutes: FastifyPluginAsync<SpaceRoutesOptions> = async (app, opts) => {
  const { spaceStore, threadStore, eventStore, memberStore } = opts;

  app.post('/', { schema: { tags: ['spaces'], summary: 'Create a space' } }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = body.name;
    const type = body.type;
    const visibility = body.visibility ?? 'team';
    const description = body.description;
    const createdBy = 'system';

    if (typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: 'INVALID_NAME', message: 'name is required' });
    }
    if (typeof type !== 'string' || !isSpaceType(type)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_TYPE', message: 'type is invalid' });
    }
    if (typeof visibility !== 'string' || !isSpaceVisibility(visibility)) {
      return reply.code(400).send({ error: 'INVALID_VISIBILITY', message: 'visibility is invalid' });
    }
    if (description !== undefined && typeof description !== 'string') {
      return reply.code(400).send({ error: 'INVALID_DESCRIPTION', message: 'description must be a string' });
    }

    const space = await spaceStore.createSpace({
      name: name.trim(),
      type,
      visibility,
      description: typeof description === 'string' ? description : '',
      createdBy,
    });

    await memberStore.addMember({
      spaceId: space.id,
      memberType: 'human',
      memberId: createdBy,
      role: 'owner',
    });

    return reply.code(201).send(space);
  });

  app.get('/', { schema: { tags: ['spaces'], summary: 'List spaces' } }, async () => {
    return spaceStore.listSpaces();
  });

  app.get('/:spaceId', { schema: { tags: ['spaces'], summary: 'Get a space' } }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }

    const space = await spaceStore.getSpace(spaceId);
    if (!space) {
      return reply.code(404).send({ error: 'SPACE_NOT_FOUND', message: `Space '${spaceId}' was not found` });
    }
    return space;
  });

  app.delete('/:spaceId', { schema: { tags: ['spaces'], summary: 'Delete a space' } }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }

    const deleted = await spaceStore.deleteSpace(spaceId);
    if (!deleted) {
      return reply.code(404).send({ error: 'SPACE_NOT_FOUND', message: `Space '${spaceId}' was not found` });
    }

    return reply.send({ ok: true });
  });

  app.get('/:spaceId/members', { schema: { tags: ['spaces'], summary: 'List space members' } }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }
    const space = await spaceStore.getSpace(spaceId);
    if (!space) {
      return reply.code(404).send({ error: 'SPACE_NOT_FOUND', message: `Space '${spaceId}' was not found` });
    }
    return memberStore.listMembers(spaceId);
  });

  app.post('/:spaceId/members', { schema: { tags: ['spaces'], summary: 'Add a space member' } }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }
    const space = await spaceStore.getSpace(spaceId);
    if (!space) {
      return reply.code(404).send({ error: 'SPACE_NOT_FOUND', message: `Space '${spaceId}' was not found` });
    }
    if (typeof body.memberType !== 'string' || !isSpaceMemberType(body.memberType)) {
      return reply.code(400).send({ error: 'INVALID_MEMBER_TYPE', message: 'memberType is invalid' });
    }
    if (typeof body.memberId !== 'string' || body.memberId.length === 0) {
      return reply.code(400).send({ error: 'INVALID_MEMBER_ID', message: 'memberId is required' });
    }
    if (body.role !== undefined && (typeof body.role !== 'string' || !isSpaceMemberRole(body.role))) {
      return reply.code(400).send({ error: 'INVALID_ROLE', message: 'role is invalid' });
    }

    const member = await memberStore.addMember({
      spaceId,
      memberType: body.memberType,
      memberId: body.memberId,
      role: typeof body.role === 'string' ? body.role : 'member',
    });

    return reply.code(201).send(member);
  });

  app.delete('/:spaceId/members/:memberType/:memberId', { schema: { tags: ['spaces'], summary: 'Remove a member' } }, async (request, reply) => {
    const { spaceId, memberType, memberId } = request.params as Record<string, string>;
    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }

    const removed = await memberStore.removeMember(spaceId, memberType, memberId);
    if (!removed) {
      return reply.code(404).send({ error: 'MEMBER_NOT_FOUND', message: 'member was not found' });
    }

    return reply.send({ ok: true });
  });

  app.get('/:spaceId/threads', { schema: { tags: ['spaces'], summary: 'List threads for a space' } }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }
    const space = await spaceStore.getSpace(spaceId);
    if (!space) {
      return reply.code(404).send({ error: 'SPACE_NOT_FOUND', message: `Space '${spaceId}' was not found` });
    }
    return threadStore.listThreadsBySpace(spaceId);
  });

  app.post('/:spaceId/threads', { schema: { tags: ['spaces'], summary: 'Create a thread' } }, async (request, reply) => {
    const { spaceId } = request.params as { spaceId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (!isUuid(spaceId)) {
      return reply.code(400).send({ error: 'INVALID_SPACE_ID', message: 'spaceId must be a UUID' });
    }
    const space = await spaceStore.getSpace(spaceId);
    if (!space) {
      return reply.code(404).send({ error: 'SPACE_NOT_FOUND', message: `Space '${spaceId}' was not found` });
    }
    if (typeof body.type !== 'string' || !isThreadType(body.type)) {
      return reply.code(400).send({ error: 'INVALID_THREAD_TYPE', message: 'type is invalid' });
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      return reply.code(400).send({ error: 'INVALID_THREAD_TITLE', message: 'title must be a string' });
    }

    const thread = await threadStore.createThread({
      spaceId,
      type: body.type,
      title: typeof body.title === 'string' ? body.title : undefined,
    });

    return reply.code(201).send(thread);
  });

  app.get('/:spaceId/threads/:threadId/events', { schema: { tags: ['spaces'], summary: 'List thread events' } }, async (request, reply) => {
    const { spaceId, threadId } = request.params as { spaceId: string; threadId: string };
    const query = request.query as { after?: string; limit?: string };

    if (!isUuid(spaceId) || !isUuid(threadId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'spaceId and threadId must be UUIDs' });
    }

    const thread = await threadStore.getThread(threadId);
    if (!thread || thread.spaceId !== spaceId) {
      return reply.code(404).send({ error: 'THREAD_NOT_FOUND', message: 'thread was not found in this space' });
    }

    const afterSequence = query.after ? Number(query.after) : undefined;
    const limit = query.limit ? Number(query.limit) : undefined;
    if (afterSequence !== undefined && !Number.isInteger(afterSequence)) {
      return reply.code(400).send({ error: 'INVALID_AFTER', message: 'after must be an integer' });
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return reply.code(400).send({ error: 'INVALID_LIMIT', message: 'limit must be a positive integer' });
    }

    return eventStore.listEvents(threadId, { afterSequence, limit });
  });

  app.post('/:spaceId/threads/:threadId/events', { schema: { tags: ['spaces'], summary: 'Append a thread event' } }, async (request, reply) => {
    const { spaceId, threadId } = request.params as { spaceId: string; threadId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (!isUuid(spaceId) || !isUuid(threadId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'spaceId and threadId must be UUIDs' });
    }

    const thread = await threadStore.getThread(threadId);
    if (!thread || thread.spaceId !== spaceId) {
      return reply.code(404).send({ error: 'THREAD_NOT_FOUND', message: 'thread was not found in this space' });
    }

    if (typeof body.type !== 'string' || !isSpaceEventType(body.type)) {
      return reply.code(400).send({ error: 'INVALID_EVENT_TYPE', message: 'type is invalid' });
    }
    if (typeof body.senderType !== 'string' || !isEventSenderType(body.senderType)) {
      return reply.code(400).send({ error: 'INVALID_SENDER_TYPE', message: 'senderType is invalid' });
    }
    if (typeof body.senderId !== 'string' || body.senderId.length === 0) {
      return reply.code(400).send({ error: 'INVALID_SENDER_ID', message: 'senderId is required' });
    }
    if (
      body.payload === undefined ||
      body.payload === null ||
      typeof body.payload !== 'object' ||
      Array.isArray(body.payload)
    ) {
      return reply.code(400).send({ error: 'INVALID_PAYLOAD', message: 'payload must be an object' });
    }
    if (body.visibility !== undefined && (typeof body.visibility !== 'string' || !isEventVisibility(body.visibility))) {
      return reply.code(400).send({ error: 'INVALID_VISIBILITY', message: 'visibility is invalid' });
    }

    const event = await eventStore.appendEvent({
      spaceId,
      threadId,
      type: body.type,
      senderType: body.senderType,
      senderId: body.senderId,
      payload: body.payload as Record<string, unknown>,
      visibility: typeof body.visibility === 'string' ? body.visibility : 'public',
      idempotencyKey:
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : crypto.randomUUID(),
      correlationId:
        typeof body.correlationId === 'string' && body.correlationId.length > 0
          ? body.correlationId
          : crypto.randomUUID(),
    });

    return reply.code(201).send(event);
  });
};
```

- [ ] **Step 2: add route tests**

Minimum coverage:
- `POST /api/spaces` creates a space and auto-adds the creator as owner
- `GET /api/spaces/:spaceId` returns `404` for unknown space
- invalid UUID paths return `400`
- `POST /:spaceId/threads/:threadId/events` returns `404` for thread/space mismatch
- provided `idempotencyKey` is forwarded to `eventStore.appendEvent`

- [ ] **Step 3: verify and commit**

```bash
cd packages/control-plane
pnpm vitest run src/api/routes/spaces.test.ts

git add packages/control-plane/src/api/routes/spaces.ts packages/control-plane/src/api/routes/spaces.test.ts
git commit -m "feat(cp): add collaboration routes"
```

### Task 8: Register the new routes in `createServer()`

**Files:**
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: register stores and routes only when `db` is configured**

```typescript
// packages/control-plane/src/api/server.ts
import { createEventStore } from '../collaboration/event-store.js';
import { createMemberStore } from '../collaboration/member-store.js';
import { createSpaceStore } from '../collaboration/space-store.js';
import { createThreadStore } from '../collaboration/thread-store.js';
import { spaceRoutes } from './routes/spaces.js';

// Also add a Swagger tag next to the existing `sessions` / `memory` / `audit`
// tags so `/api/docs` groups the new collaboration endpoints cleanly:
// { name: 'spaces', description: 'Collaboration spaces, threads, members, and events' }

if (db) {
  const spaceStore = createSpaceStore(db);
  const threadStore = createThreadStore(db);
  const memberStore = createMemberStore(db);
  const eventStore = createEventStore(db);

  await app.register(spaceRoutes, {
    prefix: '/api/spaces',
    spaceStore,
    threadStore,
    memberStore,
    eventStore,
  });
}
```

- [ ] **Step 2: verify build**

```bash
cd packages/control-plane
pnpm build
```

- [ ] **Step 3: commit**

```bash
git add packages/control-plane/src/api/server.ts
git commit -m "feat(cp): register collaboration routes"
```

---

## Chunk 3: Web API Client, Queries, and UI

### Task 9: Add collaboration endpoints to `api.ts` and `queries.ts`

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: extend `api.ts`**

Add shared collaboration types to the existing import list and extend the exported `api` object. Do **not** create a second set of top-level fetch helpers; this repo already centralizes network behavior in `request()`.

```typescript
// packages/web/src/lib/api.ts
import type {
  EventSenderType,
  EventVisibility,
  Space,
  SpaceEvent,
  SpaceMember,
  SpaceType,
  SpaceVisibility,
  SpaceEventType,
  Thread,
  ThreadType,
} from '@agentctl/shared';

export type { Space, SpaceEvent, SpaceMember, Thread };

export const api = {
  // existing entries...

  listSpaces: () => request<Space[]>('/api/spaces'),
  getSpace: (spaceId: string) => request<Space>(`/api/spaces/${spaceId}`),
  createSpace: (body: {
    name: string;
    type: SpaceType;
    visibility?: SpaceVisibility;
    description?: string;
  }) =>
    request<Space>('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteSpace: (spaceId: string) =>
    request<{ ok: boolean }>(`/api/spaces/${spaceId}`, {
      method: 'DELETE',
    }),

  listSpaceMembers: (spaceId: string) => request<SpaceMember[]>(`/api/spaces/${spaceId}/members`),
  addSpaceMember: (
    spaceId: string,
    body: { memberType: 'human' | 'agent'; memberId: string; role?: 'owner' | 'member' | 'observer' },
  ) =>
    request<SpaceMember>(`/api/spaces/${spaceId}/members`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeSpaceMember: (spaceId: string, memberType: string, memberId: string) =>
    request<{ ok: boolean }>(`/api/spaces/${spaceId}/members/${memberType}/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),

  listSpaceThreads: (spaceId: string) => request<Thread[]>(`/api/spaces/${spaceId}/threads`),
  createSpaceThread: (spaceId: string, body: { type: ThreadType; title?: string }) =>
    request<Thread>(`/api/spaces/${spaceId}/threads`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listSpaceEvents: (
    spaceId: string,
    threadId: string,
    params?: { after?: number; limit?: number },
  ) => {
    const qs = new URLSearchParams();
    if (params?.after !== undefined) qs.set('after', String(params.after));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<SpaceEvent[]>(`/api/spaces/${spaceId}/threads/${threadId}/events${suffix}`);
  },
  createSpaceEvent: (
    spaceId: string,
    threadId: string,
    body: {
      type: SpaceEventType;
      senderType: EventSenderType;
      senderId: string;
      payload: Record<string, unknown>;
      visibility?: EventVisibility;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) =>
    request<SpaceEvent>(`/api/spaces/${spaceId}/threads/${threadId}/events`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
```

- [ ] **Step 2: extend `queries.ts`**

```typescript
// packages/web/src/lib/queries.ts
export const queryKeys = {
  // existing keys...
  spaces: ['spaces'] as const,
  space: (spaceId: string) => ['spaces', spaceId] as const,
  spaceMembers: (spaceId: string) => ['spaces', spaceId, 'members'] as const,
  spaceThreads: (spaceId: string) => ['spaces', spaceId, 'threads'] as const,
  spaceThreadEvents: (spaceId: string, threadId: string, params?: { after?: number; limit?: number }) =>
    params
      ? (['spaces', spaceId, 'threads', threadId, 'events', params] as const)
      : (['spaces', spaceId, 'threads', threadId, 'events'] as const),
};

export function spacesQuery() {
  return queryOptions({
    queryKey: queryKeys.spaces,
    queryFn: api.listSpaces,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceQuery(spaceId: string) {
  return queryOptions({
    queryKey: queryKeys.space(spaceId),
    queryFn: () => api.getSpace(spaceId),
    enabled: !!spaceId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceMembersQuery(spaceId: string) {
  return queryOptions({
    queryKey: queryKeys.spaceMembers(spaceId),
    queryFn: () => api.listSpaceMembers(spaceId),
    enabled: !!spaceId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceThreadsQuery(spaceId: string) {
  return queryOptions({
    queryKey: queryKeys.spaceThreads(spaceId),
    queryFn: () => api.listSpaceThreads(spaceId),
    enabled: !!spaceId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceThreadEventsQuery(
  spaceId: string,
  threadId: string,
  params?: { after?: number; limit?: number },
) {
  return queryOptions({
    queryKey: queryKeys.spaceThreadEvents(spaceId, threadId, params),
    queryFn: () => api.listSpaceEvents(spaceId, threadId, params),
    enabled: !!spaceId && !!threadId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 3: verify and commit**

```bash
cd packages/web
pnpm build

git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(web): add collaboration api client and queries"
```

### Task 10: Build the Spaces list and Space detail views

**Files:**
- Create: `packages/web/src/views/SpacesPage.tsx`
- Create: `packages/web/src/views/SpaceDetailView.tsx`
- Create: `packages/web/src/views/SpacesPage.test.tsx`
- Create: `packages/web/src/views/SpaceDetailView.test.tsx`
- Create: `packages/web/src/app/spaces/layout.tsx`
- Create: `packages/web/src/app/spaces/page.tsx`
- Create: `packages/web/src/app/spaces/[id]/page.tsx`

**Repo alignment rule:** use the same patterns as `SessionsPage`, `DiscoverPage`, and `Sidebar`. That means:
- `useQuery(spacesQuery())`, not ad hoc `{ queryKey, queryFn }` literals when a reusable query option belongs in `queries.ts`
- `api.createSpace(...)` and `api.createSpaceEvent(...)` for mutations
- `QueryClient` invalidation through `queryKeys.*`
- reuse existing UI primitives (`Card`, `Button`, `Skeleton`, `EmptyState`, `FetchingBar`, `ErrorBanner`, `useToast`) instead of raw unstyled elements everywhere

- [ ] **Step 1: create the App Router shells**

```typescript
// packages/web/src/app/spaces/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Spaces' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

```typescript
// packages/web/src/app/spaces/page.tsx
import { SpacesPage } from '@/views/SpacesPage';

export default function Page() {
  return <SpacesPage />;
}
```

```typescript
// packages/web/src/app/spaces/[id]/page.tsx
'use client';

import { SpaceDetailView } from '@/views/SpaceDetailView';

export default function Page() {
  return <SpaceDetailView />;
}
```

- [ ] **Step 2: implement `SpacesPage`**

Minimum behavior:
- list Spaces with `useQuery(spacesQuery())`
- create a Space with `useMutation`
- delete a Space with `useMutation`
- invalidate `queryKeys.spaces`
- render loading, error, and empty states
- link each row to `/spaces/:id`

- [ ] **Step 3: implement `SpaceDetailView`**

Minimum behavior:
- get `spaceId` from `useParams`
- query `spaceQuery(spaceId)` and `spaceThreadsQuery(spaceId)`
- when threads load, default-select the first thread if none is selected
- query `spaceThreadEventsQuery(spaceId, threadId, { limit: 200 })`
- create a thread
- post a message event with client-generated `idempotencyKey` and `correlationId`

Skeleton:

```typescript
// inside SpaceDetailView
const params = useParams<{ id: string }>();
const spaceId = params.id;
const queryClient = useQueryClient();
const toast = useToast();

const space = useQuery(spaceQuery(spaceId));
const threads = useQuery(spaceThreadsQuery(spaceId));
const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

useEffect(() => {
  if (!selectedThreadId && (threads.data?.length ?? 0) > 0) {
    setSelectedThreadId(threads.data?.[0]?.id ?? null);
  }
}, [selectedThreadId, threads.data]);

const events = useQuery(
  spaceThreadEventsQuery(spaceId, selectedThreadId ?? '', { limit: 200 }),
);

const createThread = useMutation({
  mutationFn: (title: string) =>
    api.createSpaceThread(spaceId, {
      type: 'discussion',
      title: title.trim() || undefined,
    }),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.spaceThreads(spaceId) });
  },
});

const sendMessage = useMutation({
  mutationFn: (text: string) =>
    api.createSpaceEvent(spaceId, selectedThreadId as string, {
      type: 'message',
      senderType: 'human',
      senderId: 'system',
      payload: { text },
      idempotencyKey: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
    }),
  onSuccess: async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.spaceThreadEvents(spaceId, selectedThreadId as string),
    });
  },
});
```

- [ ] **Step 4: add view tests**

Follow the same style as `DiscoverPage.test.tsx`:
- wrap in `QueryClientProvider`
- mock `queries.ts`
- mock `api` mutation methods
- assert headings, empty states, and mutation calls

Minimum cases:
- `SpacesPage` renders fetched spaces
- `SpacesPage` create flow calls `api.createSpace`
- `SpaceDetailView` renders thread events
- `SpaceDetailView` sends a message only when a thread is selected

- [ ] **Step 5: verify and commit**

```bash
cd packages/web
pnpm vitest run src/views/SpacesPage.test.tsx src/views/SpaceDetailView.test.tsx
pnpm build

git add packages/web/src/views/SpacesPage.tsx \
  packages/web/src/views/SpaceDetailView.tsx \
  packages/web/src/views/SpacesPage.test.tsx \
  packages/web/src/views/SpaceDetailView.test.tsx \
  packages/web/src/app/spaces/layout.tsx \
  packages/web/src/app/spaces/page.tsx \
  packages/web/src/app/spaces/[id]/page.tsx
git commit -m "feat(web): add spaces views"
```

### Task 11: Add Spaces to the sidebar and update sidebar tests

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/components/Sidebar.test.tsx`

- [ ] **Step 1: add the nav item and keep shortcuts coherent**

Suggested update:

```typescript
// packages/web/src/components/Sidebar.tsx
import { MessagesSquare } from 'lucide-react';

const SIDEBAR_GO_MAP: Record<string, string> = {
  d: '/',
  s: '/sessions',
  p: '/spaces',
  a: '/agents',
  m: '/machines',
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Gauge, shortcut: '1' },
  { href: '/machines', label: 'Machines', icon: Server, shortcut: '2' },
  { href: '/agents', label: 'Agents', icon: Bot, shortcut: '3' },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare, shortcut: '4' },
  { href: '/spaces', label: 'Spaces', icon: MessagesSquare, shortcut: '5' },
  { href: '/discover', label: 'Discover', icon: Compass, shortcut: '6' },
  { href: '/logs', label: 'Logs', icon: ScrollText, shortcut: '7' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: '8' },
  { href: '/memory', label: 'Memory', icon: Database, shortcut: '9' },
];
```

- [ ] **Step 2: update tests**

`Sidebar.test.tsx` must update the expected nav items and shortcut numbers, and add one active-route assertion for `/spaces`.

- [ ] **Step 3: verify and commit**

```bash
cd packages/web
pnpm vitest run src/components/Sidebar.test.tsx
pnpm build

git add packages/web/src/components/Sidebar.tsx packages/web/src/components/Sidebar.test.tsx
git commit -m "feat(web): add spaces navigation"
```

---

## Chunk 4: Integration, Verification, and Release Discipline

### Task 12: Add an integration test for the collaboration route lifecycle

**Files:**
- Create: `packages/control-plane/src/integration/spaces.test.ts`

- [ ] **Step 1: add an integration-style route test**

Use in-memory store doubles rather than brittle DB mocks. Cover the full flow:

1. create space
2. auto-add owner member
3. create thread
4. append message event
5. list events
6. attempt thread mismatch and expect `404`

- [ ] **Step 2: verify and commit**

```bash
cd packages/control-plane
pnpm vitest run src/integration/spaces.test.ts

git add packages/control-plane/src/integration/spaces.test.ts
git commit -m "test(cp): add collaboration route integration flow"
```

### Task 13: Verify the whole change set before implementation is declared done

**Files:** none

- [ ] **Step 1: build shared**

```bash
pnpm --filter @agentctl/shared build
```

- [ ] **Step 2: build control-plane**

```bash
pnpm --filter @agentctl/control-plane build
```

- [ ] **Step 3: run control-plane tests**

```bash
pnpm --filter @agentctl/control-plane test
```

- [ ] **Step 4: build web**

```bash
pnpm --filter @agentctl/web build
```

- [ ] **Step 5: run web tests**

```bash
pnpm --filter @agentctl/web test
```

- [ ] **Step 6: run repo formatting and lint checks**

```bash
pnpm check
```

- [ ] **Step 7: use conventional commit messages consistently**

Required format:

```text
type(scope): subject
```

Use these types only:
- `feat`
- `fix`
- `test`
- `refactor`
- `docs`
- `style`

Good examples from this plan:
- `feat(shared): add collaboration types and validators`
- `feat(cp): add collaboration schema tables`
- `feat(cp): add transactional event store`
- `feat(web): add spaces views`
- `test(cp): add collaboration route integration flow`

Avoid:
- `WIP`
- `misc updates`
- `final fix`
- `feat: stuff`
- `git push origin main` in the plan itself

- [ ] **Step 8: make the final formatting-only commit only if needed**

```bash
git add -A
git commit -m "style(repo): apply formatting for collaboration changes"
```

If there are no remaining staged changes, skip the commit instead of forcing an empty one.

---

## Deferred From Phase 1

These stay out of scope for this implementation plan:

- NATS JetStream and outbox publishing
- WebSocket / SSE collaboration fanout
- approval gates and mobile notifications
- task graph execution
- cross-space context borrowing
- budget tracking on spaces
- external A2A / MCP interoperability

The only legacy-session work in Phase 1 is durable session-to-space linking. Full auto-bridge wiring into every session lifecycle path can land in Phase 1.1 once the core collaboration surfaces are stable.

---

## File Summary

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/shared/src/types/collaboration.ts` | Collaboration types + validators |
| Modify | `packages/shared/src/types/index.ts` | Re-export collaboration types |
| Modify | `packages/control-plane/src/db/schema.ts` | Spaces, members, threads, events, session links |
| Create | `packages/control-plane/src/db/schema-collaboration.test.ts` | Schema export tests |
| Create | `packages/control-plane/drizzle/0013_add_collaboration_spaces.sql` | Collaboration migration |
| Modify | `packages/control-plane/drizzle/meta/_journal.json` | Ensure migration discoverability if needed |
| Create | `packages/control-plane/src/collaboration/space-store.ts` | Space store |
| Create | `packages/control-plane/src/collaboration/thread-store.ts` | Thread store |
| Create | `packages/control-plane/src/collaboration/member-store.ts` | Member store |
| Create | `packages/control-plane/src/collaboration/event-store.ts` | Transactional event store |
| Create | `packages/control-plane/src/collaboration/session-space-link-store.ts` | Durable session-space links |
| Create | `packages/control-plane/src/collaboration/session-bridge.ts` | Idempotent legacy session bridge |
| Create | `packages/control-plane/src/collaboration/*.test.ts` | Store and bridge unit tests |
| Create | `packages/control-plane/src/api/routes/spaces.ts` | Collaboration routes |
| Create | `packages/control-plane/src/api/routes/spaces.test.ts` | Collaboration route tests |
| Modify | `packages/control-plane/src/api/server.ts` | Route registration |
| Create | `packages/control-plane/src/integration/spaces.test.ts` | Route lifecycle integration test |
| Modify | `packages/web/src/lib/api.ts` | Collaboration API client methods |
| Modify | `packages/web/src/lib/queries.ts` | React Query keys and query options |
| Create | `packages/web/src/views/SpacesPage.tsx` | Spaces list UI |
| Create | `packages/web/src/views/SpaceDetailView.tsx` | Space detail UI |
| Create | `packages/web/src/views/*.test.tsx` | View tests |
| Create | `packages/web/src/app/spaces/layout.tsx` | App Router layout |
| Create | `packages/web/src/app/spaces/page.tsx` | Spaces page shell |
| Create | `packages/web/src/app/spaces/[id]/page.tsx` | Space detail page shell |
| Modify | `packages/web/src/components/Sidebar.tsx` | Add Spaces nav item |
| Modify | `packages/web/src/components/Sidebar.test.tsx` | Update nav expectations |

---

## Changelog

- Replaced the non-atomic `MAX(sequence_num) + 1` event sequencing plan with a transactional counter on `threads.last_event_sequence`.
- Added `session_space_links` and an idempotent `SessionBridge`, because the prior bridge design would have duplicated Spaces on every run.
- Reworked routes to use Fastify `prefix` registration and explicit `400` / `404` validation responses instead of relying on unregistered error handlers in tests.
- Updated store guidance to use repo-realistic Drizzle mocks and `returning({ id })` delete patterns instead of `rowCount` assumptions.
- Moved web integration onto the repo's existing `api.ts` + `queries.ts` architecture and dropped the parallel set of ad hoc fetch helpers.
- Updated the frontend plan to include view components and sidebar test changes so the new `/spaces` route fits the current Next.js 16 app structure.
- Removed the hard-coded `git push origin main` step and tightened commit guidance to conventional commits only.
- Added explicit verification steps for shared, control-plane, and web packages so completion claims can be backed by fresh evidence.
