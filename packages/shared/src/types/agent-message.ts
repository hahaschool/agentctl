// ── Agent Bus Message Protocol ──────────────────────────────

import type { EventVisibility, ThreadType } from './collaboration.js';

export const AGENT_MESSAGE_TYPES = [
  'request',
  'response',
  'inform',
  'delegate',
  'escalate',
  'ack',
] as const;
export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

export function isAgentMessageType(v: string): v is AgentMessageType {
  return (AGENT_MESSAGE_TYPES as readonly string[]).includes(v);
}

export const AGENT_PAYLOAD_KINDS = [
  'ask',
  'deliver',
  'delegate-task',
  'escalate-to-human',
  'steer',
  'ack',
] as const;
export type AgentPayloadKind = (typeof AGENT_PAYLOAD_KINDS)[number];

// ── Payload variants ────────────────────────────────────────

export type ArtifactRef = {
  readonly artifactId: string;
  readonly spaceId?: string;
};

export type AskPayload = {
  readonly kind: 'ask';
  readonly question: string;
  readonly context?: readonly ArtifactRef[];
};

export type DeliverPayload = {
  readonly kind: 'deliver';
  readonly artifactIds: readonly string[];
};

export type DelegateTaskPayload = {
  readonly kind: 'delegate-task';
  readonly taskDefinitionId: string;
  readonly briefing: string;
};

export type EscalateToHumanPayload = {
  readonly kind: 'escalate-to-human';
  readonly reason: string;
  readonly urgency: 'low' | 'high' | 'critical';
};

export type SteerPayload = {
  readonly kind: 'steer';
  readonly instruction: string;
};

export type AckPayload = {
  readonly kind: 'ack';
  readonly originalMessageId: string;
  readonly status: 'received' | 'processing' | 'done';
};

export type AgentPayload =
  | AskPayload
  | DeliverPayload
  | DelegateTaskPayload
  | EscalateToHumanPayload
  | SteerPayload
  | AckPayload;

// ── Agent Message envelope ──────────────────────────────────

export type AgentMessage = {
  readonly id: string;
  readonly from: string;
  readonly to: string | 'broadcast';
  readonly spaceId: string;
  readonly threadId: string;
  readonly sequenceNum: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly type: AgentMessageType;
  readonly payload: AgentPayload;
  readonly visibility: EventVisibility;
  readonly replyTo?: string;
  readonly timestamp: number;
};

// ── Subscription Filter ─────────────────────────────────────

export type SubscriptionFilter = {
  readonly threadTypes?: readonly ThreadType[];
  readonly minVisibility?: 'public' | 'internal';
};
