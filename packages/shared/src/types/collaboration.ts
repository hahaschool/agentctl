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
