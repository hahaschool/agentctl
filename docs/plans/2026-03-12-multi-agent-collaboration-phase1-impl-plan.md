# Multi-Agent Collaboration Phase 1: Spaces + Threads + Messages — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Space/Thread/Message data model to agentctl, wrapping existing sessions as solo Spaces and enabling the foundation for multi-agent collaboration.

**Architecture:** Add three new DB tables (spaces, threads, space_events) to PostgreSQL via Drizzle ORM. Expose CRUD routes via Fastify. Add shared types to `@agentctl/shared`. Build a minimal web UI (Spaces list + Thread view) using React Query. Existing sessions map to `type: "solo"` Spaces with a single execution thread.

**Tech Stack:** Drizzle ORM, Fastify, React Query v5, Next.js 16, Vitest, pnpm workspaces

**Design Doc:** `docs/plans/2026-03-12-multi-agent-collaboration-design.md`

---

## Chunk 1: Shared Types + DB Schema + Migration

### Task 1: Define shared collaboration types

**Files:**
- Create: `packages/shared/src/types/collaboration.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Write the type file**

```typescript
// packages/shared/src/types/collaboration.ts

// ── Space ────────────────────────────────────────────────────

export const SPACE_TYPES = ['collaboration', 'solo', 'fleet-overview'] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const SPACE_VISIBILITIES = ['private', 'team', 'public'] as const;
export type SpaceVisibility = (typeof SPACE_VISIBILITIES)[number];

export const SPACE_MEMBER_ROLES = ['owner', 'member', 'observer'] as const;
export type SpaceMemberRole = (typeof SPACE_MEMBER_ROLES)[number];

export const SPACE_MEMBER_TYPES = ['human', 'agent'] as const;
export type SpaceMemberType = (typeof SPACE_MEMBER_TYPES)[number];

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

export function isSpaceType(v: string): v is SpaceType {
  return (SPACE_TYPES as readonly string[]).includes(v);
}

export function isSpaceVisibility(v: string): v is SpaceVisibility {
  return (SPACE_VISIBILITIES as readonly string[]).includes(v);
}

// ── Thread ───────────────────────────────────────────────────

export const THREAD_TYPES = ['discussion', 'execution', 'review', 'approval'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export type Thread = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string | null;
  readonly type: ThreadType;
  readonly createdAt: string;
};

export function isThreadType(v: string): v is ThreadType {
  return (THREAD_TYPES as readonly string[]).includes(v);
}

// ── Space Event (append-only message/event model) ────────────

export const SPACE_EVENT_TYPES = ['message', 'artifact', 'control', 'task-state', 'approval'] as const;
export type SpaceEventType = (typeof SPACE_EVENT_TYPES)[number];

export const EVENT_SENDER_TYPES = ['human', 'agent', 'system'] as const;
export type EventSenderType = (typeof EVENT_SENDER_TYPES)[number];

export const EVENT_VISIBILITIES = ['public', 'internal', 'silent'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export type SpaceEvent = {
  readonly id: string;
  readonly spaceId: string;
  readonly threadId: string;
  readonly sequenceNum: number;
  readonly type: SpaceEventType;
  readonly senderType: EventSenderType;
  readonly senderId: string;
  readonly payload: Record<string, unknown>;
  readonly visibility: EventVisibility;
  readonly createdAt: string;
};

export function isSpaceEventType(v: string): v is SpaceEventType {
  return (SPACE_EVENT_TYPES as readonly string[]).includes(v);
}

export function isEventVisibility(v: string): v is EventVisibility {
  return (EVENT_VISIBILITIES as readonly string[]).includes(v);
}
```

- [ ] **Step 2: Re-export from types index**

Add to `packages/shared/src/types/index.ts`:

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
  isEventVisibility,
  isSpaceEventType,
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

- [ ] **Step 3: Build shared package to verify**

Run: `cd packages/shared && pnpm build`
Expected: Build succeeds, no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/collaboration.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add Space, Thread, SpaceEvent collaboration types"
```

---

### Task 2: Add Drizzle schema tables for spaces, threads, space_events, space_members

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`

- [ ] **Step 1: Write the failing test for schema exports**

Create `packages/control-plane/src/db/schema-collaboration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { spaceEvents, spaceMembers, spaces, threads } from './schema.js';

describe('collaboration schema tables', () => {
  it('exports spaces table with required columns', () => {
    expect(spaces).toBeDefined();
    expect(spaces.id).toBeDefined();
    expect(spaces.name).toBeDefined();
    expect(spaces.type).toBeDefined();
    expect(spaces.visibility).toBeDefined();
    expect(spaces.createdBy).toBeDefined();
  });

  it('exports threads table with required columns', () => {
    expect(threads).toBeDefined();
    expect(threads.id).toBeDefined();
    expect(threads.spaceId).toBeDefined();
    expect(threads.type).toBeDefined();
  });

  it('exports spaceEvents table with required columns', () => {
    expect(spaceEvents).toBeDefined();
    expect(spaceEvents.id).toBeDefined();
    expect(spaceEvents.threadId).toBeDefined();
    expect(spaceEvents.sequenceNum).toBeDefined();
    expect(spaceEvents.idempotencyKey).toBeDefined();
  });

  it('exports spaceMembers table with required columns', () => {
    expect(spaceMembers).toBeDefined();
    expect(spaceMembers.spaceId).toBeDefined();
    expect(spaceMembers.memberType).toBeDefined();
    expect(spaceMembers.memberId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/db/schema-collaboration.test.ts`
Expected: FAIL — spaces, threads, spaceEvents, spaceMembers not exported

- [ ] **Step 3: Add schema tables to schema.ts**

Add `primaryKey` to the existing import from `drizzle-orm/pg-core` at the top of `schema.ts`, then append:

```typescript
// ── Collaboration: Spaces + Threads + Events ─────────────────

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  type: text('type').notNull(),
  visibility: text('visibility').default('team'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_threads_space_id').on(table.spaceId),
  ],
);

export const spaceEvents = pgTable(
  'space_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id),
    sequenceNum: bigint('sequence_num', { mode: 'number' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    correlationId: text('correlation_id').notNull(),
    type: text('type').notNull(),
    senderType: text('sender_type').notNull(),
    senderId: text('sender_id').notNull(),
    payload: jsonb('payload').notNull(),
    visibility: text('visibility').default('public'),
    published: boolean('published').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_space_events_thread_seq').on(table.threadId, table.sequenceNum),
    index('idx_space_events_outbox').on(table.published),
  ],
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/db/schema-collaboration.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/src/db/schema-collaboration.test.ts
git commit -m "feat(cp): add Drizzle schema for spaces, threads, space_events, space_members"
```

---

### Task 3: Write SQL migration

**Files:**
- Create: `packages/control-plane/drizzle/0013_add_collaboration_spaces.sql`

- [ ] **Step 1: Write migration file**

```sql
-- 0013_add_collaboration_spaces.sql
-- Adds core tables for the multi-agent collaboration model (Phase 1).

CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('collaboration', 'solo', 'fleet-overview')),
  visibility TEXT DEFAULT 'team' CHECK (visibility IN ('private', 'team', 'public')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('human', 'agent')),
  member_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'observer')),
  PRIMARY KEY (space_id, member_type, member_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_member_id ON space_members (member_id);

CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('discussion', 'execution', 'review', 'approval')),
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_threads_space_id ON threads (space_id);

CREATE TABLE IF NOT EXISTS space_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id),
  thread_id UUID NOT NULL REFERENCES threads(id),
  sequence_num BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('message', 'artifact', 'control', 'task-state', 'approval')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
  sender_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'internal', 'silent')),
  published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (thread_id, sequence_num)
);

CREATE INDEX IF NOT EXISTS idx_space_events_thread_seq ON space_events (thread_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_space_events_outbox ON space_events (published) WHERE published = FALSE;
```

- [ ] **Step 2: Verify migration syntax is valid**

Run: `cd packages/control-plane && psql "$DATABASE_URL" -f drizzle/0013_add_collaboration_spaces.sql`
Expected: Tables created (or `NOTICE: relation already exists` if re-run)

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/drizzle/0013_add_collaboration_spaces.sql
git commit -m "feat(cp): add migration 0013 — spaces, threads, space_events tables"
```

---

## Chunk 2: Control Plane CRUD Routes

### Task 4: Space store (data access layer)

**Files:**
- Create: `packages/control-plane/src/collaboration/space-store.ts`
- Create: `packages/control-plane/src/collaboration/space-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/collaboration/space-store.test.ts
import { describe, expect, it, vi } from 'vitest';

import type { SpaceStore } from './space-store.js';

// Minimal mock of drizzle DB for unit tests
function createMockDb() {
  const rows: Record<string, unknown[]> = { spaces: [], space_members: [] };
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => [{ id: 'space-1', name: 'test', type: 'solo', visibility: 'team', description: '', createdBy: 'user-1', createdAt: new Date().toISOString() }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue([]),
        orderBy: vi.fn().mockReturnValue([]),
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue([]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ rowCount: 1 }),
    }),
  };
}

describe('SpaceStore', () => {
  it('creates a space and returns it', async () => {
    const db = createMockDb();
    const { createSpaceStore } = await import('./space-store.js');
    const store = createSpaceStore(db as any);
    const space = await store.createSpace({
      name: 'test-space',
      type: 'solo',
      visibility: 'team',
      createdBy: 'user-1',
    });
    expect(space).toBeDefined();
    expect(space.id).toBe('space-1');
    expect(db.insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/space-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SpaceStore**

```typescript
// packages/control-plane/src/collaboration/space-store.ts
import type { SpaceType, SpaceVisibility } from '@agentctl/shared';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { spaceMembers, spaces, threads } from '../db/schema.js';

export type CreateSpaceInput = {
  readonly name: string;
  readonly type: SpaceType;
  readonly visibility: SpaceVisibility;
  readonly description?: string;
  readonly createdBy: string;
};

export type SpaceRecord = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly visibility: string | null;
  readonly createdBy: string;
  readonly createdAt: Date | null;
};

export type SpaceStore = {
  createSpace(input: CreateSpaceInput): Promise<SpaceRecord>;
  getSpace(id: string): Promise<SpaceRecord | undefined>;
  listSpaces(): Promise<readonly SpaceRecord[]>;
  deleteSpace(id: string): Promise<boolean>;
};

export function createSpaceStore(db: Database): SpaceStore {
  return {
    async createSpace(input) {
      const rows = await db
        .insert(spaces)
        .values({
          name: input.name,
          type: input.type,
          visibility: input.visibility,
          description: input.description ?? '',
          createdBy: input.createdBy,
        })
        .returning();
      return rows[0]!;
    },

    async getSpace(id) {
      const rows = await db.select().from(spaces).where(eq(spaces.id, id));
      return rows[0];
    },

    async listSpaces() {
      return db.select().from(spaces).orderBy(spaces.createdAt);
    },

    async deleteSpace(id) {
      const result = await db.delete(spaces).where(eq(spaces.id, id));
      return (result as any).rowCount > 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/space-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/collaboration/
git commit -m "feat(cp): add SpaceStore data access layer for spaces"
```

---

### Task 5: Thread store (data access layer)

**Files:**
- Create: `packages/control-plane/src/collaboration/thread-store.ts`
- Create: `packages/control-plane/src/collaboration/thread-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/collaboration/thread-store.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('ThreadStore', () => {
  it('creates a thread in a space', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'thread-1', spaceId: 'space-1', type: 'discussion', title: 'test', createdAt: new Date().toISOString() },
          ]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([]),
          orderBy: vi.fn().mockReturnValue([]),
        }),
      }),
    };

    const { createThreadStore } = await import('./thread-store.js');
    const store = createThreadStore(mockDb as any);
    const thread = await store.createThread({
      spaceId: 'space-1',
      type: 'discussion',
      title: 'test',
    });
    expect(thread).toBeDefined();
    expect(thread.id).toBe('thread-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/thread-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ThreadStore**

```typescript
// packages/control-plane/src/collaboration/thread-store.ts
import type { ThreadType } from '@agentctl/shared';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { threads } from '../db/schema.js';

export type CreateThreadInput = {
  readonly spaceId: string;
  readonly type: ThreadType;
  readonly title?: string;
};

export type ThreadRecord = {
  readonly id: string;
  readonly spaceId: string;
  readonly type: string;
  readonly title: string | null;
  readonly createdAt: Date | null;
};

export type ThreadStore = {
  createThread(input: CreateThreadInput): Promise<ThreadRecord>;
  getThread(id: string): Promise<ThreadRecord | undefined>;
  listThreadsBySpace(spaceId: string): Promise<readonly ThreadRecord[]>;
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
      return rows[0]!;
    },

    async getThread(id) {
      const rows = await db.select().from(threads).where(eq(threads.id, id));
      return rows[0];
    },

    async listThreadsBySpace(spaceId) {
      return db.select().from(threads).where(eq(threads.spaceId, spaceId)).orderBy(threads.createdAt);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/thread-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/collaboration/thread-store.ts packages/control-plane/src/collaboration/thread-store.test.ts
git commit -m "feat(cp): add ThreadStore data access layer"
```

---

### Task 6: Event store (append-only event log)

**Files:**
- Create: `packages/control-plane/src/collaboration/event-store.ts`
- Create: `packages/control-plane/src/collaboration/event-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/collaboration/event-store.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('EventStore', () => {
  it('appends an event with auto-incrementing sequence', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 'evt-1',
              spaceId: 'space-1',
              threadId: 'thread-1',
              sequenceNum: 1,
              idempotencyKey: 'key-1',
              correlationId: 'corr-1',
              type: 'message',
              senderType: 'human',
              senderId: 'user-1',
              payload: { text: 'hello' },
              visibility: 'public',
              published: false,
              createdAt: new Date().toISOString(),
            },
          ]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };

    const { createEventStore } = await import('./event-store.js');
    const store = createEventStore(mockDb as any);
    const event = await store.appendEvent({
      spaceId: 'space-1',
      threadId: 'thread-1',
      type: 'message',
      senderType: 'human',
      senderId: 'user-1',
      payload: { text: 'hello' },
      visibility: 'public',
      idempotencyKey: 'key-1',
      correlationId: 'corr-1',
    });
    expect(event).toBeDefined();
    expect(event.sequenceNum).toBe(1);
    expect(event.type).toBe('message');
  });

  it('rejects duplicate idempotency keys gracefully', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(
            Object.assign(new Error('unique_violation'), { code: '23505' }),
          ),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };

    const { createEventStore } = await import('./event-store.js');
    const store = createEventStore(mockDb as any);
    await expect(
      store.appendEvent({
        spaceId: 'space-1',
        threadId: 'thread-1',
        type: 'message',
        senderType: 'human',
        senderId: 'user-1',
        payload: { text: 'hello' },
        visibility: 'public',
        idempotencyKey: 'duplicate-key',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/event-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement EventStore**

```typescript
// packages/control-plane/src/collaboration/event-store.ts
import type { EventSenderType, EventVisibility, SpaceEventType } from '@agentctl/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { spaceEvents } from '../db/schema.js';

export type AppendEventInput = {
  readonly spaceId: string;
  readonly threadId: string;
  readonly type: SpaceEventType;
  readonly senderType: EventSenderType;
  readonly senderId: string;
  readonly payload: Record<string, unknown>;
  readonly visibility: EventVisibility;
  readonly idempotencyKey: string;
  readonly correlationId: string;
};

export type SpaceEventRecord = {
  readonly id: string;
  readonly spaceId: string;
  readonly threadId: string;
  readonly sequenceNum: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly type: string;
  readonly senderType: string;
  readonly senderId: string;
  readonly payload: unknown;
  readonly visibility: string | null;
  readonly published: boolean | null;
  readonly createdAt: Date | null;
};

export type EventStore = {
  appendEvent(input: AppendEventInput): Promise<SpaceEventRecord>;
  listEvents(threadId: string, opts?: { afterSequence?: number; limit?: number }): Promise<readonly SpaceEventRecord[]>;
  getUnpublished(limit?: number): Promise<readonly SpaceEventRecord[]>;
  markPublished(eventId: string): Promise<void>;
};

export function createEventStore(db: Database): EventStore {
  return {
    async appendEvent(input) {
      // Use a single atomic SQL statement to avoid the read-then-write race condition.
      // COALESCE(MAX(...), 0) + 1 is computed inside the INSERT, so concurrent writers
      // are serialized by the UNIQUE(thread_id, sequence_num) constraint.
      // On conflict (duplicate idempotency_key), return the existing row.
      const rows = await db.execute(sql`
        INSERT INTO space_events (
          id, space_id, thread_id, sequence_num, idempotency_key, correlation_id,
          type, sender_type, sender_id, payload, visibility, published, created_at
        )
        VALUES (
          gen_random_uuid(),
          ${input.spaceId},
          ${input.threadId},
          COALESCE((SELECT MAX(sequence_num) FROM space_events WHERE thread_id = ${input.threadId}), 0) + 1,
          ${input.idempotencyKey},
          ${input.correlationId},
          ${input.type},
          ${input.senderType},
          ${input.senderId},
          ${JSON.stringify(input.payload)}::jsonb,
          ${input.visibility},
          FALSE,
          now()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *
      `);

      // If ON CONFLICT hit, fetch the existing event
      if (rows.length === 0) {
        const existing = await db
          .select()
          .from(spaceEvents)
          .where(eq(spaceEvents.idempotencyKey, input.idempotencyKey));
        return existing[0]!;
      }

      return rows[0] as unknown as SpaceEventRecord;
    },

    async listEvents(threadId, opts) {
      const limit = opts?.limit ?? 100;
      const afterSeq = opts?.afterSequence ?? 0;

      return db
        .select()
        .from(spaceEvents)
        .where(
          and(
            eq(spaceEvents.threadId, threadId),
            gt(spaceEvents.sequenceNum, afterSeq),
          ),
        )
        .orderBy(spaceEvents.sequenceNum)
        .limit(limit);
    },

    async getUnpublished(limit = 100) {
      return db
        .select()
        .from(spaceEvents)
        .where(eq(spaceEvents.published, false))
        .orderBy(spaceEvents.createdAt)
        .limit(limit);
    },

    async markPublished(eventId) {
      await db
        .update(spaceEvents)
        .set({ published: true })
        .where(eq(spaceEvents.id, eventId));
    },
  };
}
```

Note: `db.update()` uses Drizzle's `.set()` which returns a new query object — immutability preserved.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/event-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/collaboration/event-store.ts packages/control-plane/src/collaboration/event-store.test.ts
git commit -m "feat(cp): add EventStore — append-only event log for space threads"
```

---

### Task 7: Spaces API routes

**Files:**
- Create: `packages/control-plane/src/api/routes/spaces.ts`
- Create: `packages/control-plane/src/api/routes/spaces.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/control-plane/src/api/routes/spaces.test.ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

import { spaceRoutes } from './spaces.js';

function createMockStores() {
  return {
    spaceStore: {
      createSpace: vi.fn().mockResolvedValue({
        id: 'space-1',
        name: 'test',
        type: 'solo',
        visibility: 'team',
        description: '',
        createdBy: 'user-1',
        createdAt: new Date().toISOString(),
      }),
      getSpace: vi.fn().mockResolvedValue({
        id: 'space-1',
        name: 'test',
        type: 'solo',
        visibility: 'team',
        description: '',
        createdBy: 'user-1',
        createdAt: new Date().toISOString(),
      }),
      listSpaces: vi.fn().mockResolvedValue([]),
      deleteSpace: vi.fn().mockResolvedValue(true),
    },
    threadStore: {
      createThread: vi.fn(),
      getThread: vi.fn(),
      listThreadsBySpace: vi.fn().mockResolvedValue([]),
    },
    eventStore: {
      appendEvent: vi.fn(),
      listEvents: vi.fn().mockResolvedValue([]),
      getUnpublished: vi.fn(),
      markPublished: vi.fn(),
    },
  };
}

describe('space routes', () => {
  it('POST /api/spaces — creates a space', async () => {
    const app = Fastify();
    const stores = createMockStores();
    await app.register(spaceRoutes, stores);

    const res = await app.inject({
      method: 'POST',
      url: '/api/spaces',
      payload: { name: 'my space', type: 'solo', visibility: 'team' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('space-1');
    expect(stores.spaceStore.createSpace).toHaveBeenCalled();
  });

  it('GET /api/spaces — lists spaces', async () => {
    const app = Fastify();
    const stores = createMockStores();
    await app.register(spaceRoutes, stores);

    const res = await app.inject({ method: 'GET', url: '/api/spaces' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/spaces/:id — gets a space', async () => {
    const app = Fastify();
    const stores = createMockStores();
    await app.register(spaceRoutes, stores);

    const res = await app.inject({ method: 'GET', url: '/api/spaces/space-1' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/spaces/:id — returns 404 for unknown space', async () => {
    const app = Fastify();
    const stores = createMockStores();
    stores.spaceStore.getSpace.mockResolvedValue(undefined);
    await app.register(spaceRoutes, stores);

    const res = await app.inject({ method: 'GET', url: '/api/spaces/unknown' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/spaces/:id — deletes a space', async () => {
    const app = Fastify();
    const stores = createMockStores();
    await app.register(spaceRoutes, stores);

    const res = await app.inject({ method: 'DELETE', url: '/api/spaces/space-1' });
    expect(res.statusCode).toBe(204);
  });

  it('GET /api/spaces/:id/threads — lists threads', async () => {
    const app = Fastify();
    const stores = createMockStores();
    await app.register(spaceRoutes, stores);

    const res = await app.inject({ method: 'GET', url: '/api/spaces/space-1/threads' });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/spaces/:id/threads — creates a thread', async () => {
    const app = Fastify();
    const stores = createMockStores();
    stores.threadStore.createThread.mockResolvedValue({
      id: 'thread-1', spaceId: 'space-1', type: 'discussion', title: 'test', createdAt: new Date().toISOString(),
    });
    await app.register(spaceRoutes, stores);

    const res = await app.inject({
      method: 'POST',
      url: '/api/spaces/space-1/threads',
      payload: { type: 'discussion', title: 'test thread' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('GET /api/spaces/:spaceId/threads/:threadId/events — lists events', async () => {
    const app = Fastify();
    const stores = createMockStores();
    await app.register(spaceRoutes, stores);

    const res = await app.inject({ method: 'GET', url: '/api/spaces/space-1/threads/thread-1/events' });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/spaces/:spaceId/threads/:threadId/events — appends event', async () => {
    const app = Fastify();
    const stores = createMockStores();
    stores.eventStore.appendEvent.mockResolvedValue({
      id: 'evt-1', spaceId: 'space-1', threadId: 'thread-1', sequenceNum: 1,
      type: 'message', senderType: 'human', senderId: 'user-1',
      payload: { text: 'hello' }, visibility: 'public',
    });
    await app.register(spaceRoutes, stores);

    const res = await app.inject({
      method: 'POST',
      url: '/api/spaces/space-1/threads/thread-1/events',
      payload: {
        type: 'message',
        senderType: 'human',
        senderId: 'user-1',
        payload: { text: 'hello' },
      },
    });
    expect(res.statusCode).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/control-plane && pnpm vitest run src/api/routes/spaces.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement space routes**

```typescript
// packages/control-plane/src/api/routes/spaces.ts
import * as crypto from 'node:crypto';

import { ControlPlaneError, isSpaceType, isSpaceVisibility, isThreadType } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';
import type { ThreadStore } from '../../collaboration/thread-store.js';

export type SpaceRoutesOptions = {
  spaceStore: SpaceStore;
  threadStore: ThreadStore;
  eventStore: EventStore;
};

export const spaceRoutes: FastifyPluginAsync<SpaceRoutesOptions> = async (app, opts) => {
  const { spaceStore, threadStore, eventStore } = opts;

  // ── Spaces CRUD ─────────────────────────────────────────────

  app.post('/api/spaces', async (req, reply) => {
    const { name, type, visibility, description } = req.body as Record<string, string>;

    if (!name || typeof name !== 'string') {
      throw new ControlPlaneError('INVALID_INPUT', 'name is required');
    }
    if (!isSpaceType(type)) {
      throw new ControlPlaneError('INVALID_INPUT', `Invalid space type: ${type}`);
    }
    if (visibility && !isSpaceVisibility(visibility)) {
      throw new ControlPlaneError('INVALID_INPUT', `Invalid visibility: ${visibility}`);
    }

    const space = await spaceStore.createSpace({
      name,
      type,
      visibility: visibility ?? 'team',
      description,
      createdBy: 'system', // TODO: extract from auth context
    });

    return reply.status(201).send(space);
  });

  app.get('/api/spaces', async () => {
    return spaceStore.listSpaces();
  });

  app.get('/api/spaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const space = await spaceStore.getSpace(id);
    if (!space) {
      return reply.status(404).send({ error: 'SPACE_NOT_FOUND', message: `Space ${id} not found` });
    }
    return space;
  });

  app.delete('/api/spaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await spaceStore.deleteSpace(id);
    return reply.status(204).send();
  });

  // ── Threads ─────────────────────────────────────────────────

  app.get('/api/spaces/:id/threads', async (req) => {
    const { id } = req.params as { id: string };
    return threadStore.listThreadsBySpace(id);
  });

  app.post('/api/spaces/:id/threads', async (req, reply) => {
    const { id: spaceId } = req.params as { id: string };
    const { type, title } = req.body as Record<string, string>;

    if (!isThreadType(type)) {
      throw new ControlPlaneError('INVALID_INPUT', `Invalid thread type: ${type}`);
    }

    const thread = await threadStore.createThread({ spaceId, type, title });
    return reply.status(201).send(thread);
  });

  // ── Events ──────────────────────────────────────────────────

  app.get('/api/spaces/:spaceId/threads/:threadId/events', async (req) => {
    const { threadId } = req.params as { spaceId: string; threadId: string };
    const { after, limit } = req.query as { after?: string; limit?: string };
    return eventStore.listEvents(threadId, {
      afterSequence: after ? Number(after) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  });

  app.post('/api/spaces/:spaceId/threads/:threadId/events', async (req, reply) => {
    const { spaceId, threadId } = req.params as { spaceId: string; threadId: string };
    const { type, senderType, senderId, payload, visibility } = req.body as Record<string, unknown>;

    if (!type || typeof type !== 'string') {
      throw new ControlPlaneError('INVALID_INPUT', 'type is required');
    }
    if (!senderType || typeof senderType !== 'string') {
      throw new ControlPlaneError('INVALID_INPUT', 'senderType is required');
    }
    if (!senderId || typeof senderId !== 'string') {
      throw new ControlPlaneError('INVALID_INPUT', 'senderId is required');
    }

    const event = await eventStore.appendEvent({
      spaceId,
      threadId,
      type: type as any,
      senderType: senderType as any,
      senderId,
      payload: (payload as Record<string, unknown>) ?? {},
      visibility: (visibility as any) ?? 'public',
      idempotencyKey: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
    });

    return reply.status(201).send(event);
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/control-plane && pnpm vitest run src/api/routes/spaces.test.ts`
Expected: PASS — all 9 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/spaces.ts packages/control-plane/src/api/routes/spaces.test.ts
git commit -m "feat(cp): add Spaces API routes — CRUD for spaces, threads, events"
```

---

### Task 8: Register routes in server.ts

**Files:**
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Add imports and registration**

In `server.ts`, add the import:
```typescript
import { spaceRoutes } from './routes/spaces.js';
```

And the store creation + route registration near the other route registrations:
```typescript
import { createSpaceStore } from '../collaboration/space-store.js';
import { createThreadStore } from '../collaboration/thread-store.js';
import { createEventStore } from '../collaboration/event-store.js';

// Inside createServer(), after db is available:
const spaceStore = createSpaceStore(db);
const threadStore = createThreadStore(db);
const eventStore = createEventStore(db);

app.register(spaceRoutes, { spaceStore, threadStore, eventStore });
```

- [ ] **Step 2: Verify build**

Run: `cd packages/control-plane && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/api/server.ts
git commit -m "feat(cp): register space routes in Fastify server"
```

---

## Chunk 3: Web Frontend — Spaces List + Thread View

### Task 9: Add Space and Thread types to web API client

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add types and query factories**

Add to `packages/web/src/lib/api.ts`:

```typescript
import type {
  Space,
  SpaceEvent,
  SpaceType,
  SpaceVisibility,
  Thread,
  ThreadType,
} from '@agentctl/shared';

export type { Space, SpaceEvent, Thread };

// ── Spaces API ─────────────────────────────────────────────

export async function fetchSpaces(): Promise<Space[]> {
  const res = await fetch('/api/spaces');
  if (!res.ok) throw new Error(`Failed to fetch spaces: ${res.statusText}`);
  return res.json();
}

export async function fetchSpace(id: string): Promise<Space> {
  const res = await fetch(`/api/spaces/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch space: ${res.statusText}`);
  return res.json();
}

export async function createSpace(input: {
  name: string;
  type: SpaceType;
  visibility?: SpaceVisibility;
}): Promise<Space> {
  const res = await fetch('/api/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create space: ${res.statusText}`);
  return res.json();
}

export async function deleteSpace(id: string): Promise<void> {
  const res = await fetch(`/api/spaces/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete space: ${res.statusText}`);
}

// ── Threads API ────────────────────────────────────────────

export async function fetchThreads(spaceId: string): Promise<Thread[]> {
  const res = await fetch(`/api/spaces/${spaceId}/threads`);
  if (!res.ok) throw new Error(`Failed to fetch threads: ${res.statusText}`);
  return res.json();
}

export async function createThread(
  spaceId: string,
  input: { type: ThreadType; title?: string },
): Promise<Thread> {
  const res = await fetch(`/api/spaces/${spaceId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create thread: ${res.statusText}`);
  return res.json();
}

// ── Events API ─────────────────────────────────────────────

export async function fetchEvents(
  spaceId: string,
  threadId: string,
  opts?: { after?: number; limit?: number },
): Promise<SpaceEvent[]> {
  const params = new URLSearchParams();
  if (opts?.after) params.set('after', String(opts.after));
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`/api/spaces/${spaceId}/threads/${threadId}/events${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.statusText}`);
  return res.json();
}

export async function postEvent(
  spaceId: string,
  threadId: string,
  input: { type: string; senderType: string; senderId: string; payload: Record<string, unknown> },
): Promise<SpaceEvent> {
  const res = await fetch(`/api/spaces/${spaceId}/threads/${threadId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to post event: ${res.statusText}`);
  return res.json();
}

// ── Query Keys ─────────────────────────────────────────────

export const spacesQueryKey = ['spaces'] as const;
export const spaceQueryKey = (id: string) => ['spaces', id] as const;
export const threadsQueryKey = (spaceId: string) => ['spaces', spaceId, 'threads'] as const;
export const eventsQueryKey = (spaceId: string, threadId: string) =>
  ['spaces', spaceId, 'threads', threadId, 'events'] as const;
```

- [ ] **Step 2: Verify build**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat(web): add Space, Thread, Event API client functions and query keys"
```

---

### Task 10: Spaces list page

**Files:**
- Create: `packages/web/src/app/spaces/page.tsx`
- Create: `packages/web/src/app/spaces/layout.tsx`

- [ ] **Step 1: Create layout**

```typescript
// packages/web/src/app/spaces/layout.tsx
export default function SpacesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 2: Create spaces list page**

```typescript
// packages/web/src/app/spaces/page.tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import {
  createSpace,
  deleteSpace,
  fetchSpaces,
  spacesQueryKey,
} from '@/lib/api';
import type { Space, SpaceType } from '@agentctl/shared';

function SpaceCard({ space, onDelete }: { space: Space; onDelete: (id: string) => void }) {
  return (
    <Link
      href={`/spaces/${space.id}`}
      className="block rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-blue-500 transition-colors"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-100">{space.name}</h3>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
          {space.type}
        </span>
      </div>
      {space.description && (
        <p className="mt-1 text-xs text-neutral-500 line-clamp-2">{space.description}</p>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-neutral-600">
        <span>{space.visibility}</span>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onDelete(space.id); }}
          className="text-red-500 hover:text-red-400"
        >
          Delete
        </button>
      </div>
    </Link>
  );
}

export default function SpacesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<SpaceType>('collaboration');

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: spacesQueryKey,
    queryFn: fetchSpaces,
  });

  const createMutation = useMutation({
    mutationFn: () => createSpace({ name, type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spacesQueryKey });
      setName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSpace,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: spacesQueryKey }),
  });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg font-semibold text-neutral-100">Spaces</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Collaborative workspaces for humans and agents.
      </p>

      {/* Create form */}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Space name..."
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as SpaceType)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-300"
        >
          <option value="collaboration">Collaboration</option>
          <option value="solo">Solo</option>
        </select>
        <button
          type="submit"
          disabled={!name.trim() || createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {/* Spaces grid */}
      {isLoading ? (
        <div className="mt-6 text-sm text-neutral-500">Loading...</div>
      ) : spaces.length === 0 ? (
        <div className="mt-6 text-sm text-neutral-500">No spaces yet. Create one above.</div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {spaces.map((s) => (
            <SpaceCard key={s.id} space={s} onDelete={(id) => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/spaces/
git commit -m "feat(web): add Spaces list page with create/delete"
```

---

### Task 11: Space detail page with thread view

**Files:**
- Create: `packages/web/src/app/spaces/[id]/page.tsx`

- [ ] **Step 1: Create space detail page**

```typescript
// packages/web/src/app/spaces/[id]/page.tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import {
  createThread,
  fetchEvents,
  fetchSpace,
  fetchThreads,
  postEvent,
  eventsQueryKey,
  spaceQueryKey,
  threadsQueryKey,
} from '@/lib/api';
import type { SpaceEvent, Thread, ThreadType } from '@agentctl/shared';

function EventRow({ event }: { event: SpaceEvent }) {
  const payload = event.payload as Record<string, unknown>;
  const text = (payload.text as string) ?? JSON.stringify(payload);
  return (
    <div className="flex gap-3 py-2 border-b border-neutral-800 last:border-0">
      <div className="flex-shrink-0 w-16 text-right">
        <span className="text-xs font-mono text-neutral-600">#{event.sequenceNum}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-blue-400">{event.senderId}</span>
          <span className="text-xs text-neutral-600">{event.senderType}</span>
          {event.visibility !== 'public' && (
            <span className="text-xs text-yellow-600">[{event.visibility}]</span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-neutral-300 whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

function ThreadPanel({ thread, spaceId }: { thread: Thread; spaceId: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const { data: events = [] } = useQuery({
    queryKey: eventsQueryKey(spaceId, thread.id),
    queryFn: () => fetchEvents(spaceId, thread.id),
    refetchInterval: 3000, // poll every 3s for now (WebSocket in Phase 2)
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      postEvent(spaceId, thread.id, {
        type: 'message',
        senderType: 'human',
        senderId: 'user-1', // TODO: from auth
        payload: { text: message },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventsQueryKey(spaceId, thread.id) });
      setMessage('');
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-neutral-800 px-4 py-2">
        <h3 className="text-sm font-medium text-neutral-100">{thread.title ?? 'Untitled'}</h3>
        <span className="text-xs text-neutral-500">{thread.type}</span>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {events.length === 0 ? (
          <div className="text-sm text-neutral-600 py-4">No messages yet.</div>
        ) : (
          events.map((e) => <EventRow key={e.id} event={e} />)
        )}
      </div>

      {/* Message input */}
      <form
        className="border-t border-neutral-800 p-3 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (message.trim()) sendMutation.mutate(); }}
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!message.trim() || sendMutation.isPending}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default function SpaceDetailPage() {
  const { id: spaceId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState('');

  const { data: space } = useQuery({
    queryKey: spaceQueryKey(spaceId),
    queryFn: () => fetchSpace(spaceId),
  });

  const { data: threadsList = [] } = useQuery({
    queryKey: threadsQueryKey(spaceId),
    queryFn: () => fetchThreads(spaceId),
  });

  const createThreadMutation = useMutation({
    mutationFn: () => createThread(spaceId, { type: 'discussion' as ThreadType, title: newThreadTitle || undefined }),
    onSuccess: (thread) => {
      queryClient.invalidateQueries({ queryKey: threadsQueryKey(spaceId) });
      setSelectedThreadId(thread.id);
      setNewThreadTitle('');
    },
  });

  const selectedThread = threadsList.find((t) => t.id === selectedThreadId);

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar: threads list */}
      <div className="w-64 flex-shrink-0 border-r border-neutral-800 flex flex-col">
        <div className="border-b border-neutral-800 p-3">
          <h2 className="text-sm font-semibold text-neutral-100">{space?.name ?? 'Space'}</h2>
          <span className="text-xs text-neutral-500">{space?.type}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {threadsList.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedThreadId(t.id)}
              className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                t.id === selectedThreadId
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              <div className="font-medium">{t.title ?? 'Untitled'}</div>
              <div className="text-xs text-neutral-600">{t.type}</div>
            </button>
          ))}
        </div>

        {/* New thread */}
        <form
          className="border-t border-neutral-800 p-2 flex gap-1"
          onSubmit={(e) => { e.preventDefault(); createThreadMutation.mutate(); }}
        >
          <input
            type="text"
            value={newThreadTitle}
            onChange={(e) => setNewThreadTitle(e.target.value)}
            placeholder="New thread..."
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={createThreadMutation.isPending}
            className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-600"
          >
            +
          </button>
        </form>
      </div>

      {/* Main: thread content */}
      <div className="flex-1">
        {selectedThread ? (
          <ThreadPanel thread={selectedThread} spaceId={spaceId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-600">
            Select or create a thread to start collaborating.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/spaces/[id]/page.tsx
git commit -m "feat(web): add Space detail page with thread panel and messaging"
```

---

### Task 12: Add Spaces to navigation

**Files:**
- Modify: navigation component (find via `grep -r "Sessions" packages/web/src/` for nav links)

- [ ] **Step 1: Find and modify the navigation component**

Search for the navigation/sidebar component that contains links to Sessions, Agents, etc. Add a "Spaces" link pointing to `/spaces`.

```typescript
// Add to the nav items array:
{ href: '/spaces', label: 'Spaces', icon: /* appropriate icon */ }
```

- [ ] **Step 2: Verify build and manual test**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds. Navigate to `/spaces` in browser to verify.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/  # staged nav file
git commit -m "feat(web): add Spaces to main navigation"
```

---

## Chunk 4: Integration Tests + Full Build Verification

### Task 13: Integration tests for spaces API

**Files:**
- Create: `packages/control-plane/src/integration/spaces.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// packages/control-plane/src/integration/spaces.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

import { spaceRoutes } from '../api/routes/spaces.js';
import type { EventStore } from '../collaboration/event-store.js';
import type { SpaceStore } from '../collaboration/space-store.js';
import type { ThreadStore } from '../collaboration/thread-store.js';

// Full integration flow: create space → create thread → post event → list events
describe('Spaces integration flow', () => {
  let spaceId: string;
  let threadId: string;

  const spaceStore: SpaceStore = {
    createSpace: vi.fn().mockImplementation(async (input) => ({
      id: 'int-space-1',
      ...input,
      createdAt: new Date().toISOString(),
    })),
    getSpace: vi.fn().mockResolvedValue({
      id: 'int-space-1',
      name: 'integration test',
      type: 'collaboration',
      visibility: 'team',
      description: '',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
    }),
    listSpaces: vi.fn().mockResolvedValue([]),
    deleteSpace: vi.fn().mockResolvedValue(true),
  };

  const threadStore: ThreadStore = {
    createThread: vi.fn().mockImplementation(async (input) => ({
      id: 'int-thread-1',
      ...input,
      createdAt: new Date().toISOString(),
    })),
    getThread: vi.fn(),
    listThreadsBySpace: vi.fn().mockResolvedValue([]),
  };

  let eventSeq = 0;
  const storedEvents: Record<string, unknown>[] = [];

  const eventStore: EventStore = {
    appendEvent: vi.fn().mockImplementation(async (input) => {
      eventSeq += 1;
      const evt = { id: `evt-${eventSeq}`, sequenceNum: eventSeq, ...input, createdAt: new Date().toISOString() };
      storedEvents.push(evt);
      return evt;
    }),
    listEvents: vi.fn().mockImplementation(async () => [...storedEvents]),
    getUnpublished: vi.fn().mockResolvedValue([]),
    markPublished: vi.fn(),
  };

  it('runs the full lifecycle: create space → create thread → post events → list events', async () => {
    const app = Fastify();
    await app.register(spaceRoutes, { spaceStore, threadStore, eventStore });

    // 1. Create space
    const spaceRes = await app.inject({
      method: 'POST',
      url: '/api/spaces',
      payload: { name: 'integration test', type: 'collaboration', visibility: 'team' },
    });
    expect(spaceRes.statusCode).toBe(201);
    spaceId = JSON.parse(spaceRes.body).id;

    // 2. Create thread
    const threadRes = await app.inject({
      method: 'POST',
      url: `/api/spaces/${spaceId}/threads`,
      payload: { type: 'discussion', title: 'General' },
    });
    expect(threadRes.statusCode).toBe(201);
    threadId = JSON.parse(threadRes.body).id;

    // 3. Post two events
    const evt1 = await app.inject({
      method: 'POST',
      url: `/api/spaces/${spaceId}/threads/${threadId}/events`,
      payload: { type: 'message', senderType: 'human', senderId: 'user-1', payload: { text: 'Hello agents!' } },
    });
    expect(evt1.statusCode).toBe(201);

    const evt2 = await app.inject({
      method: 'POST',
      url: `/api/spaces/${spaceId}/threads/${threadId}/events`,
      payload: { type: 'message', senderType: 'agent', senderId: 'architect-agent', payload: { text: 'Hello human!' } },
    });
    expect(evt2.statusCode).toBe(201);

    // 4. List events
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/spaces/${spaceId}/threads/${threadId}/events`,
    });
    expect(listRes.statusCode).toBe(200);
    const events = JSON.parse(listRes.body);
    expect(events).toHaveLength(2);
    expect(events[0].sequenceNum).toBe(1);
    expect(events[1].sequenceNum).toBe(2);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd packages/control-plane && pnpm vitest run src/integration/spaces.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/integration/spaces.test.ts
git commit -m "test(cp): add integration tests for spaces lifecycle"
```

---

### Task 14: Full monorepo build + lint verification

**Files:** None (verification only)

- [ ] **Step 1: Build shared (must pass first)**

Run: `cd /Users/hahaschool/agentctl && pnpm -r build`
Expected: All packages build successfully

- [ ] **Step 2: Run all control-plane tests**

Run: `cd packages/control-plane && pnpm vitest run`
Expected: All tests pass (existing + new collaboration tests)

- [ ] **Step 3: Run Biome lint**

Run: `pnpm check`
Expected: No errors, no warnings (or auto-fix with `pnpm check:fix`)

- [ ] **Step 4: Final commit with all formatting fixes**

```bash
git add -A
git commit -m "fix(lint): apply Biome formatting to collaboration module"
```

- [ ] **Step 5: Push to remote**

```bash
git push origin main
```

---

## Chunk 5: Session Migration + SpaceMembers + Deferred Items

### Task 15: SpaceMembers store and routes

**Files:**
- Create: `packages/control-plane/src/collaboration/member-store.ts`
- Create: `packages/control-plane/src/collaboration/member-store.test.ts`
- Modify: `packages/control-plane/src/api/routes/spaces.ts` (add member endpoints)

- [ ] **Step 1: Write failing test for MemberStore**

```typescript
// packages/control-plane/src/collaboration/member-store.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('MemberStore', () => {
  it('adds a member to a space', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { spaceId: 'space-1', memberType: 'human', memberId: 'user-1', role: 'owner' },
            ]),
          }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      }),
    };

    const { createMemberStore } = await import('./member-store.js');
    const store = createMemberStore(mockDb as any);
    const member = await store.addMember({
      spaceId: 'space-1',
      memberType: 'human',
      memberId: 'user-1',
      role: 'owner',
    });
    expect(member).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/member-store.test.ts`

- [ ] **Step 3: Implement MemberStore**

```typescript
// packages/control-plane/src/collaboration/member-store.ts
import type { SpaceMemberRole, SpaceMemberType } from '@agentctl/shared';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { spaceMembers } from '../db/schema.js';

export type AddMemberInput = {
  readonly spaceId: string;
  readonly memberType: SpaceMemberType;
  readonly memberId: string;
  readonly role: SpaceMemberRole;
};

export type MemberRecord = {
  readonly spaceId: string;
  readonly memberType: string;
  readonly memberId: string;
  readonly role: string;
};

export type MemberStore = {
  addMember(input: AddMemberInput): Promise<MemberRecord>;
  removeMember(spaceId: string, memberType: string, memberId: string): Promise<boolean>;
  listMembers(spaceId: string): Promise<readonly MemberRecord[]>;
};

export function createMemberStore(db: Database): MemberStore {
  return {
    async addMember(input) {
      const rows = await db
        .insert(spaceMembers)
        .values(input)
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? input; // If conflict, return input as-is
    },

    async removeMember(spaceId, memberType, memberId) {
      const result = await db
        .delete(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, spaceId),
            eq(spaceMembers.memberType, memberType),
            eq(spaceMembers.memberId, memberId),
          ),
        );
      return (result as any).rowCount > 0;
    },

    async listMembers(spaceId) {
      return db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));
    },
  };
}
```

- [ ] **Step 4: Add member routes to spaces.ts**

Add to the existing `spaceRoutes` in `spaces.ts`:

```typescript
// Add memberStore to SpaceRoutesOptions type
// Then add these routes:

app.get('/api/spaces/:id/members', async (req) => {
  const { id } = req.params as { id: string };
  return memberStore.listMembers(id);
});

app.post('/api/spaces/:id/members', async (req, reply) => {
  const { id: spaceId } = req.params as { id: string };
  const { memberType, memberId, role } = req.body as Record<string, string>;
  const member = await memberStore.addMember({
    spaceId,
    memberType: memberType as any,
    memberId,
    role: (role ?? 'member') as any,
  });
  return reply.status(201).send(member);
});

app.delete('/api/spaces/:id/members/:memberType/:memberId', async (req, reply) => {
  const { id, memberType, memberId } = req.params as Record<string, string>;
  await memberStore.removeMember(id, memberType, memberId);
  return reply.status(204).send();
});
```

- [ ] **Step 5: Auto-add creator as owner in createSpace**

In `space-store.ts`, modify `createSpace` to also insert a member:

```typescript
// After creating the space, add creator as owner member
// This requires memberStore to be injected or the logic to be in the route handler
```

The cleaner approach: in the POST /api/spaces route handler, after `spaceStore.createSpace()`, call:
```typescript
await memberStore.addMember({
  spaceId: space.id,
  memberType: 'human',
  memberId: space.createdBy,
  role: 'owner',
});
```

- [ ] **Step 6: Run tests, commit**

```bash
cd packages/control-plane && pnpm vitest run src/collaboration/member-store.test.ts
git add packages/control-plane/src/collaboration/member-store.ts packages/control-plane/src/collaboration/member-store.test.ts packages/control-plane/src/api/routes/spaces.ts
git commit -m "feat(cp): add SpaceMembers store and routes, auto-add creator as owner"
```

---

### Task 16: Session-to-Space migration bridge

**Files:**
- Create: `packages/control-plane/src/collaboration/session-bridge.ts`
- Create: `packages/control-plane/src/collaboration/session-bridge.test.ts`

This bridges existing sessions into the Space model. Each existing `rcSession` or `managedSession` gets a corresponding solo Space with a single execution Thread.

- [ ] **Step 1: Write failing test**

```typescript
// packages/control-plane/src/collaboration/session-bridge.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('SessionBridge', () => {
  it('creates a solo Space for an existing session', async () => {
    const mockSpaceStore = {
      createSpace: vi.fn().mockResolvedValue({
        id: 'space-1', name: 'Session: abc123', type: 'solo',
        visibility: 'private', createdBy: 'system', createdAt: new Date().toISOString(),
      }),
    };
    const mockThreadStore = {
      createThread: vi.fn().mockResolvedValue({
        id: 'thread-1', spaceId: 'space-1', type: 'execution', title: 'Main',
        createdAt: new Date().toISOString(),
      }),
    };
    const mockMemberStore = {
      addMember: vi.fn().mockResolvedValue({
        spaceId: 'space-1', memberType: 'agent', memberId: 'agent-1', role: 'member',
      }),
    };

    const { createSessionBridge } = await import('./session-bridge.js');
    const bridge = createSessionBridge(mockSpaceStore as any, mockThreadStore as any, mockMemberStore as any);

    const result = await bridge.wrapSessionAsSpace({
      sessionId: 'abc123',
      projectPath: '/home/user/project',
      agentId: 'agent-1',
    });

    expect(result.space.id).toBe('space-1');
    expect(result.thread.id).toBe('thread-1');
    expect(mockSpaceStore.createSpace).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'solo', name: expect.stringContaining('abc123') }),
    );
    expect(mockThreadStore.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'space-1', type: 'execution' }),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/session-bridge.test.ts`

- [ ] **Step 3: Implement SessionBridge**

```typescript
// packages/control-plane/src/collaboration/session-bridge.ts
import type { MemberStore } from './member-store.js';
import type { SpaceStore, SpaceRecord } from './space-store.js';
import type { ThreadStore, ThreadRecord } from './thread-store.js';

export type WrapSessionInput = {
  readonly sessionId: string;
  readonly projectPath: string;
  readonly agentId?: string;
};

export type WrapSessionResult = {
  readonly space: SpaceRecord;
  readonly thread: ThreadRecord;
};

export type SessionBridge = {
  wrapSessionAsSpace(input: WrapSessionInput): Promise<WrapSessionResult>;
};

export function createSessionBridge(
  spaceStore: SpaceStore,
  threadStore: ThreadStore,
  memberStore: MemberStore,
): SessionBridge {
  return {
    async wrapSessionAsSpace(input) {
      const space = await spaceStore.createSpace({
        name: `Session: ${input.sessionId.slice(0, 8)}`,
        type: 'solo',
        visibility: 'private',
        description: `Auto-created from session ${input.sessionId} at ${input.projectPath}`,
        createdBy: 'system',
      });

      const thread = await threadStore.createThread({
        spaceId: space.id,
        type: 'execution',
        title: 'Main',
      });

      // Add agent as member if provided
      if (input.agentId) {
        await memberStore.addMember({
          spaceId: space.id,
          memberType: 'agent',
          memberId: input.agentId,
          role: 'member',
        });
      }

      return { space, thread };
    },
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd packages/control-plane && pnpm vitest run src/collaboration/session-bridge.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/collaboration/session-bridge.ts packages/control-plane/src/collaboration/session-bridge.test.ts
git commit -m "feat(cp): add SessionBridge — wraps existing sessions as solo Spaces"
```

---

### Deferred to Phase 2 (acknowledged)

These design doc fields are intentionally omitted from Phase 1:
- `Space.icon` — cosmetic, easy to add later
- `Space.costBudget` — requires cost tracking plumbing
- `Space.taskGraphId` — requires Task Graph tables (Phase 3)
- Mobile notification pipeline — requires push notification infrastructure
- WebSocket real-time events — using 3s polling in Phase 1

---

## File Structure Summary

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `packages/shared/src/types/collaboration.ts` | Space, Thread, SpaceEvent types + guards |
| Modify | `packages/shared/src/types/index.ts` | Re-export collaboration types |
| Modify | `packages/control-plane/src/db/schema.ts` | Drizzle table definitions |
| Create | `packages/control-plane/src/db/schema-collaboration.test.ts` | Schema export tests |
| Create | `packages/control-plane/drizzle/0013_add_collaboration_spaces.sql` | SQL migration |
| Create | `packages/control-plane/src/collaboration/space-store.ts` | Space data access |
| Create | `packages/control-plane/src/collaboration/space-store.test.ts` | Space store tests |
| Create | `packages/control-plane/src/collaboration/thread-store.ts` | Thread data access |
| Create | `packages/control-plane/src/collaboration/thread-store.test.ts` | Thread store tests |
| Create | `packages/control-plane/src/collaboration/event-store.ts` | Append-only event log |
| Create | `packages/control-plane/src/collaboration/event-store.test.ts` | Event store tests |
| Create | `packages/control-plane/src/api/routes/spaces.ts` | REST API routes |
| Create | `packages/control-plane/src/api/routes/spaces.test.ts` | Route tests (9 cases) |
| Modify | `packages/control-plane/src/api/server.ts` | Register space routes |
| Modify | `packages/web/src/lib/api.ts` | API client + query keys |
| Create | `packages/web/src/app/spaces/layout.tsx` | Spaces layout |
| Create | `packages/web/src/app/spaces/page.tsx` | Spaces list page |
| Create | `packages/web/src/app/spaces/[id]/page.tsx` | Space detail + threads |
| Modify | `packages/web/src/...` (nav component) | Add Spaces nav link |
| Create | `packages/control-plane/src/integration/spaces.test.ts` | Integration tests |
| Create | `packages/control-plane/src/collaboration/member-store.ts` | SpaceMembers data access |
| Create | `packages/control-plane/src/collaboration/member-store.test.ts` | Member store tests |
| Create | `packages/control-plane/src/collaboration/session-bridge.ts` | Session → Space bridge |
| Create | `packages/control-plane/src/collaboration/session-bridge.test.ts` | Session bridge tests |
