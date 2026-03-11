import type { AgentEvent } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SseClient, SseClientError } from './sse-client.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));

vi.stubGlobal('fetch', mocks.fetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createControlledStream(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  done: Promise<void>;
} {
  let resolveOuter: () => void;
  const done = new Promise<void>((r) => {
    resolveOuter = r;
  });

  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index] as Uint8Array);
        index++;
      } else {
        controller.close();
        resolveOuter();
      }
    },
  });

  return { stream, done };
}

function sseFrame(_event: string, data: unknown, id?: string): string {
  let frame = '';
  if (_event) frame += `event: ${_event}\n`;
  if (id) frame += `id: ${id}\n`;
  frame += `data: ${JSON.stringify(data)}\n\n`;
  return frame;
}

function makeSseResponse(text: string): { response: Response; done: Promise<void> } {
  const encoder = new TextEncoder();
  const { stream, done } = createControlledStream([encoder.encode(text)]);
  const response = new Response(stream, {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'text/event-stream' },
  });
  return { response, done };
}

function emptySseResponse(): { response: Response; done: Promise<void> } {
  return makeSseResponse('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SseClient', () => {
  let client: SseClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (client) client.close();
  });

  // Helper: create a client that won't auto-reconnect (for most tests)
  function makeClient(
    opts?: Partial<{
      maxReconnectAttempts: number;
      baseUrl: string;
      authToken: string;
      maxBufferSize: number;
      reconnectBaseDelayMs: number;
    }>,
  ): SseClient {
    client = new SseClient({
      baseUrl: opts?.baseUrl ?? 'https://cp.example.com',
      authToken: opts?.authToken,
      maxReconnectAttempts: opts?.maxReconnectAttempts ?? 0, // No reconnect by default
      reconnectBaseDelayMs: opts?.reconnectBaseDelayMs ?? 50,
      maxBufferSize: opts?.maxBufferSize,
    });
    return client;
  }

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  describe('connect()', () => {
    it('sends GET to correct SSE endpoint URL', async () => {
      const c = makeClient();
      const { response, done } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('agent-1');
      await done;

      const url = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(url).toBe('https://cp.example.com/api/agents/agent-1/stream');
    });

    it('includes auth token in request headers', async () => {
      const c = makeClient({ authToken: 'tok_123' });
      const { response, done } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok_123');
    });

    it('sets Accept header to text/event-stream', async () => {
      const c = makeClient();
      const { response, done } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Accept).toBe('text/event-stream');
    });

    it('emits open event on successful connection', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('open', handler);
      const { response, done } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
    });

    it('URL-encodes the agent ID', async () => {
      const c = makeClient();
      const { response, done } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('agent/special');
      await done;

      const url = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('agent%2Fspecial');
    });

    it('sets Cache-Control to no-cache', async () => {
      const c = makeClient();
      const { response, done } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Cache-Control']).toBe('no-cache');
    });
  });

  // -----------------------------------------------------------------------
  // Event parsing
  // -----------------------------------------------------------------------

  describe('event parsing', () => {
    it('parses SSE output events and emits them', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const agentEvent: AgentEvent = {
        event: 'output',
        data: { type: 'text', content: 'Hello world' },
      };
      const { response, done } = makeSseResponse(sseFrame('output', agentEvent));
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(agentEvent);
    });

    it('parses multiple events from a single chunk', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const event1: AgentEvent = { event: 'output', data: { type: 'text', content: 'Line 1' } };
      const event2: AgentEvent = { event: 'status', data: { status: 'running' } };

      const chunk = sseFrame('output', event1) + sseFrame('status', event2);
      const { response, done } = makeSseResponse(chunk);
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('handles events split across multiple chunks', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const agentEvent: AgentEvent = { event: 'cost', data: { turnCost: 0.05, totalCost: 1.25 } };
      const fullFrame = sseFrame('cost', agentEvent);
      const half = Math.floor(fullFrame.length / 2);
      const encoder = new TextEncoder();

      const { stream, done } = createControlledStream([
        encoder.encode(fullFrame.slice(0, half)),
        encoder.encode(fullFrame.slice(half)),
      ]);
      mocks.fetch.mockResolvedValueOnce(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(agentEvent);
    });

    it('ignores SSE comment lines (starting with colon)', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const chunk =
        ':this is a comment\ndata: {"event":"output","data":{"type":"text","content":"hi"}}\n\n';
      const { response, done } = makeSseResponse(chunk);
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
    });

    it('handles heartbeat events', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const heartbeat: AgentEvent = { event: 'heartbeat', data: { timestamp: 1234567890 } };
      const { response, done } = makeSseResponse(sseFrame('heartbeat', heartbeat));
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(heartbeat);
    });

    it('handles loop_iteration events', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const loopEvent: AgentEvent = {
        event: 'loop_iteration',
        data: { iteration: 3, costUsd: 0.15, durationMs: 5000 },
      };
      const { response, done } = makeSseResponse(sseFrame('loop_iteration', loopEvent));
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(loopEvent);
    });

    it('handles loop_complete events', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const completeEvent: AgentEvent = {
        event: 'loop_complete',
        data: { totalIterations: 10, totalCostUsd: 1.5, reason: 'max_iterations' },
      };
      const { response, done } = makeSseResponse(sseFrame('loop_complete', completeEvent));
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(completeEvent);
    });

    it('handles approval_needed events', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const approvalEvent: AgentEvent = {
        event: 'approval_needed',
        data: { tool: 'Bash', input: { command: 'rm -rf' }, timeoutSeconds: 60 },
      };
      const { response, done } = makeSseResponse(sseFrame('approval_needed', approvalEvent));
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(approvalEvent);
    });

    it('reconstructs execution_summary events from the SSE event name and data payload', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('event', handler);

      const summaryEvent: AgentEvent = {
        event: 'execution_summary',
        data: {
          summary: {
            status: 'success',
            workCompleted: 'Updated latestRunSummary from the live stream.',
            executiveSummary: 'Updated latestRunSummary from the live stream.',
            keyFindings: ['Mobile clients no longer wait for the next runs fetch.'],
            filesChanged: [],
            commandsRun: 1,
            toolUsageBreakdown: { Edit: 1 },
            followUps: [],
            branchName: null,
            prUrl: null,
            tokensUsed: { input: 50, output: 12 },
            costUsd: 0.03,
            durationMs: 1_200,
          },
        },
      };
      const { response, done } = makeSseResponse(sseFrame('execution_summary', summaryEvent.data));
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(summaryEvent);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('emits error on network failure', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('error', handler);
      mocks.fetch.mockRejectedValueOnce(new TypeError('Network failure'));

      c.connect('a1');
      await new Promise((r) => setTimeout(r, 20));

      const networkError = handler.mock.calls.find(
        (call) => (call[0] as SseClientError).code === 'NETWORK_ERROR',
      );
      expect(networkError).toBeDefined();
    });

    it('emits error on non-2xx HTTP response', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('error', handler);
      mocks.fetch.mockResolvedValueOnce(
        new Response('Not found', { status: 404, statusText: 'Not Found' }),
      );

      c.connect('a1');
      await new Promise((r) => setTimeout(r, 20));

      const httpError = handler.mock.calls.find(
        (call) => (call[0] as SseClientError).code === 'HTTP_ERROR',
      );
      expect(httpError).toBeDefined();
      expect((httpError?.[0] as SseClientError).context?.status).toBe(404);
    });

    it('emits error on invalid JSON in SSE data', async () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('error', handler);

      const { response, done } = makeSseResponse('data: not-json\n\n');
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      const parseError = handler.mock.calls.find(
        (call) => (call[0] as SseClientError).code === 'PARSE_ERROR',
      );
      expect(parseError).toBeDefined();
    });

    it('emits error when buffer exceeds max size', async () => {
      const c = makeClient({ maxBufferSize: 50 });
      const handler = vi.fn();
      c.on('error', handler);

      // Big chunk with no frame separator so buffer grows
      const bigChunk = `data: ${'x'.repeat(100)}`;
      const { response, done } = makeSseResponse(bigChunk);
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      await done;

      const overflowError = handler.mock.calls.find(
        (call) => (call[0] as SseClientError).code === 'BUFFER_OVERFLOW',
      );
      expect(overflowError).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Reconnection
  // -----------------------------------------------------------------------

  describe('reconnection', () => {
    it('schedules reconnect when stream ends and maxReconnectAttempts > 0', async () => {
      const c = makeClient({ maxReconnectAttempts: 1, reconnectBaseDelayMs: 10000 });
      const reconnHandler = vi.fn();
      c.on('reconnecting', reconnHandler);

      // Use a Response with null body - triggers NO_BODY error path which
      // calls scheduleReconnect, emitting 'reconnecting' when attempts remain.
      const response = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(response);
      // Provide a second response for the scheduled reconnect
      // (won't fire during this test due to high delay, but needed to avoid
      // unhandled fetch calls)
      const r2 = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(r2);

      c.connect('a1');

      await vi.waitFor(() => expect(reconnHandler).toHaveBeenCalledOnce());

      expect(reconnHandler.mock.calls[0]?.[0].attempt).toBe(1);
    });

    it('does not reconnect when maxReconnectAttempts is 0', async () => {
      const c = makeClient({ maxReconnectAttempts: 0 });
      const reconnHandler = vi.fn();
      const closeHandler = vi.fn();
      c.on('reconnecting', reconnHandler);
      c.on('close', closeHandler);

      // Use a Response with null body - triggers NO_BODY error path, which
      // then calls scheduleReconnect (which should NOT emit 'reconnecting'
      // when maxReconnectAttempts is 0).
      const response = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');

      // Wait for close event (emitted by scheduleReconnect when max exceeded)
      await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled(), { timeout: 2000 });

      expect(reconnHandler).not.toHaveBeenCalled();
    });

    it('does not reconnect after close() is called', () => {
      const c = makeClient({ maxReconnectAttempts: 5 });
      const reconnHandler = vi.fn();
      c.on('reconnecting', reconnHandler);

      const { response } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      c.close();

      // reconnect should not fire
      expect(reconnHandler).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // close()
  // -----------------------------------------------------------------------

  describe('close()', () => {
    it('emits close event', () => {
      const c = makeClient();
      const handler = vi.fn();
      c.on('close', handler);

      const { response } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      c.close();

      expect(handler).toHaveBeenCalledOnce();
    });

    it('sets isStreaming to false', () => {
      const c = makeClient();
      const { response } = emptySseResponse();
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      expect(c.isStreaming).toBe(true);

      c.close();
      expect(c.isStreaming).toBe(false);
    });

    it('resets reconnect counter', () => {
      const c = makeClient({ maxReconnectAttempts: 5 });

      const response = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(response);

      c.connect('a1');
      c.close();
      expect(c.currentReconnectAttempt).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // setAuthToken
  // -----------------------------------------------------------------------

  describe('setAuthToken()', () => {
    it('uses updated token on next connection', async () => {
      const c = makeClient();
      // First connection without token
      const r1 = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(r1);

      c.connect('a1');
      // Wait for fetch to be called
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
      c.close();

      // Second connection with token
      const r2 = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(r2);

      c.setAuthToken('new-token');
      c.connect('a1');

      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));

      const init = mocks.fetch.mock.calls[1]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer new-token');
    });
  });

  // -----------------------------------------------------------------------
  // on() / off()
  // -----------------------------------------------------------------------

  describe('on() / off()', () => {
    it('supports multiple handlers for the same event', async () => {
      const c = makeClient();
      const h1 = vi.fn();
      const h2 = vi.fn();
      c.on('open', h1);
      c.on('open', h2);

      const response = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(response);
      c.connect('a1');

      await vi.waitFor(() => {
        expect(h1).toHaveBeenCalledOnce();
        expect(h2).toHaveBeenCalledOnce();
      });
    });

    it('removes handler with off()', async () => {
      const c = makeClient();
      const handler = vi.fn();
      const otherHandler = vi.fn();
      c.on('open', handler);
      c.off('open', handler);
      // Add another handler so we can wait for the open event
      c.on('open', otherHandler);

      const response = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(response);
      c.connect('a1');

      await vi.waitFor(() => expect(otherHandler).toHaveBeenCalledOnce());

      expect(handler).not.toHaveBeenCalled();
    });

    it('swallows errors thrown by event handlers', async () => {
      const c = makeClient();
      const thrower = vi.fn(() => {
        throw new Error('boom');
      });
      const normal = vi.fn();
      c.on('open', thrower);
      c.on('open', normal);

      const response = new Response(null, { status: 200 });
      mocks.fetch.mockResolvedValueOnce(response);
      c.connect('a1');

      await vi.waitFor(() => expect(normal).toHaveBeenCalledOnce());
    });
  });

  // -----------------------------------------------------------------------
  // parseFrame (internal)
  // -----------------------------------------------------------------------

  describe('parseFrame()', () => {
    it('parses event, data, and id fields', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        'event: output\ndata: {"type":"text"}\nid: 42',
      );
      expect(frame).toEqual({ event: 'output', data: '{"type":"text"}', id: '42', retry: null });
    });

    it('parses retry field as number', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        'retry: 5000\ndata: {}',
      );
      expect((frame as Record<string, unknown>).retry).toBe(5000);
    });

    it('handles multi-line data', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        'data: line1\ndata: line2',
      );
      expect((frame as Record<string, unknown>).data).toBe('line1\nline2');
    });

    it('skips comment lines', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        ':comment\ndata: {"ok":true}',
      );
      expect((frame as Record<string, unknown>).data).toBe('{"ok":true}');
    });

    it('ignores unknown fields', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        'unknownfield: value\ndata: {"ok":true}',
      );
      expect((frame as Record<string, unknown>).data).toBe('{"ok":true}');
    });

    it('handles fields with no value (no colon)', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        'data\nevent: test',
      );
      expect((frame as Record<string, unknown>).event).toBe('test');
    });

    it('ignores invalid retry values', () => {
      const c = makeClient();
      const frame = (c as unknown as { parseFrame: (text: string) => unknown }).parseFrame(
        'retry: abc\ndata: {}',
      );
      expect((frame as Record<string, unknown>).retry).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // SseClientError
  // -----------------------------------------------------------------------

  describe('SseClientError', () => {
    it('has the correct name property', () => {
      const err = new SseClientError('TEST', 'msg');
      expect(err.name).toBe('SseClientError');
    });

    it('stores code, message, and context', () => {
      const err = new SseClientError('C', 'M', { key: 'val' });
      expect(err.code).toBe('C');
      expect(err.message).toBe('M');
      expect(err.context).toEqual({ key: 'val' });
    });

    it('is an instance of Error', () => {
      expect(new SseClientError('C', 'M')).toBeInstanceOf(Error);
    });

    it('works without context', () => {
      const err = new SseClientError('C', 'M');
      expect(err.context).toBeUndefined();
    });
  });
});
