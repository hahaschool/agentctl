// ---------------------------------------------------------------------------
// WebSocket wire protocol — discriminated unions for client/server messages
// ---------------------------------------------------------------------------

/** All valid client → server message type discriminants. */
const CLIENT_MESSAGE_TYPES = [
  'agent:start',
  'agent:stop',
  'agent:signal',
  'agent:subscribe',
  'agent:unsubscribe',
  'ping',
] as const;

type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export type WsClientMessage =
  | { type: 'agent:start'; agentId: string; machineId: string; prompt: string; model?: string }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:signal'; agentId: string; message: string; metadata?: Record<string, unknown> }
  | { type: 'agent:subscribe'; agentId: string }
  | { type: 'agent:unsubscribe'; agentId: string }
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export type WsServerMessage =
  | { type: 'agent:started'; agentId: string; sessionId?: string }
  | { type: 'agent:stopped'; agentId: string }
  | { type: 'agent:output'; agentId: string; data: string; stream: 'stdout' | 'stderr' }
  | { type: 'agent:status'; agentId: string; status: string }
  | { type: 'agent:error'; agentId: string; error: string; code?: string }
  | {
      type: 'agent:cost_alert';
      agentId: string;
      message: string;
      severity: string;
      percentage: number;
    }
  | { type: 'pong' }
  | { type: 'error'; message: string; code?: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a raw JSON string into a `WsClientMessage`.
 *
 * Returns `null` when:
 * - the string is not valid JSON
 * - the parsed value is not an object
 * - the `type` field is missing or not a recognised client message type
 */
export function parseClientMessage(raw: string): WsClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (!isValidClientMessageType(obj.type as string)) {
    return null;
  }

  return obj as unknown as WsClientMessage;
}

/**
 * Serialise a `WsServerMessage` to a JSON string for transmission over the
 * WebSocket.
 */
export function serializeServerMessage(msg: WsServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Runtime check that `type` is one of the known client message discriminants.
 */
export function isValidClientMessageType(type: string): boolean {
  return CLIENT_MESSAGE_TYPES.includes(type as ClientMessageType);
}
