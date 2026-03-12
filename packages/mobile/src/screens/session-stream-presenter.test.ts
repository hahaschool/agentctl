import type { AgentEvent, ContentMessage } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionStreamState } from './session-stream-presenter.js';
import { SessionStreamPresenter } from './session-stream-presenter.js';

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

function sseFrame(eventName: string, data: unknown): string {
  let frame = '';
  if (eventName) frame += `event: ${eventName}\n`;
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

function makeJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makePresenter(
  opts?: Partial<{ onChange: (s: SessionStreamState) => void; authToken: string }>,
): SessionStreamPresenter {
  return new SessionStreamPresenter({
    baseUrl: 'https://cp.example.com',
    authToken: opts?.authToken,
    maxStreamLines: 100,
    timeoutMs: 5_000,
    onChange: opts?.onChange,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionStreamPresenter', () => {
  let presenter: SessionStreamPresenter;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (presenter) presenter.destroy();
  });

  // -----------------------------------------------------------------------
  // Live streaming
  // -----------------------------------------------------------------------

  describe('connectLive()', () => {
    it('connects to the session SSE endpoint and emits stream lines', async () => {
      const states: SessionStreamState[] = [];
      presenter = makePresenter({ onChange: (s) => states.push(s) });

      const agentEvent: AgentEvent = {
        event: 'output',
        data: { type: 'text', content: 'Hello from session' },
      };
      const { response, done } = makeSseResponse(sseFrame('output', agentEvent));
      mocks.fetch.mockResolvedValueOnce(response);

      presenter.connectLive('session-abc');
      await done;
      // Allow microtasks to flush
      await new Promise((r) => setTimeout(r, 20));

      // Verify it connected to the correct URL
      const url = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(url).toBe('https://cp.example.com/api/sessions/session-abc/stream');

      // Verify stream lines were produced
      const lastState = states[states.length - 1];
      expect(lastState?.mode).toBe('live');
      expect(lastState?.streamLines.length).toBeGreaterThanOrEqual(1);
      expect(lastState?.streamLines[0]?.event).toEqual(agentEvent);
    });

    it('sets isStreaming to true during active stream', async () => {
      const states: SessionStreamState[] = [];
      presenter = makePresenter({ onChange: (s) => states.push(s) });

      const { response, done } = makeSseResponse(
        sseFrame('output', { event: 'output', data: { type: 'text', content: 'x' } }),
      );
      mocks.fetch.mockResolvedValueOnce(response);

      presenter.connectLive('s1');
      await done;
      await new Promise((r) => setTimeout(r, 20));

      // Should have been streaming at some point
      const streamingStates = states.filter((s) => s.isStreaming);
      expect(streamingStates.length).toBeGreaterThan(0);
    });

    it('includes auth token in request headers when provided', async () => {
      presenter = makePresenter({ authToken: 'tok_secret' });

      const { response, done } = makeSseResponse('');
      mocks.fetch.mockResolvedValueOnce(response);

      presenter.connectLive('s1');
      await done;

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok_secret');
    });
  });

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  describe('loadReplay()', () => {
    it('fetches session content and populates replay messages', async () => {
      const states: SessionStreamState[] = [];
      presenter = makePresenter({ onChange: (s) => states.push(s) });

      const messages: ContentMessage[] = [
        { type: 'human', content: 'Build a feature' },
        { type: 'assistant', content: 'Sure, let me help.' },
        { type: 'tool_use', content: 'Edit file.ts', toolName: 'Edit' },
      ];
      mocks.fetch.mockResolvedValueOnce(makeJsonResponse({ messages }));

      await presenter.loadReplay('session-xyz', 'machine-1');

      // Verify correct URL was called
      const url = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('/api/sessions/content/session-xyz');
      expect(url).toContain('machineId=machine-1');

      // Verify replay messages
      const lastState = states[states.length - 1];
      expect(lastState?.mode).toBe('replay');
      expect(lastState?.replayMessages).toHaveLength(3);
      expect(lastState?.replayMessages[0]?.type).toBe('human');
      expect(lastState?.replayMessages[2]?.toolName).toBe('Edit');
      // All messages start collapsed
      expect(lastState?.replayMessages.every((m) => !m.expanded)).toBe(true);
      // Scrubber should be at the last message
      expect(lastState?.scrubberPosition).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // toggleMessageExpanded
  // -----------------------------------------------------------------------

  describe('toggleMessageExpanded()', () => {
    it('toggles expanded state for a replay message', async () => {
      const states: SessionStreamState[] = [];
      presenter = makePresenter({ onChange: (s) => states.push(s) });

      const messages: ContentMessage[] = [
        { type: 'thinking', content: 'Let me think...' },
        { type: 'assistant', content: 'Done' },
      ];
      mocks.fetch.mockResolvedValueOnce(makeJsonResponse({ messages }));
      await presenter.loadReplay('s1', 'm1');

      presenter.toggleMessageExpanded(0);

      const lastState = states[states.length - 1];
      expect(lastState?.replayMessages[0]?.expanded).toBe(true);
      expect(lastState?.replayMessages[1]?.expanded).toBe(false);

      // Toggle again to collapse
      presenter.toggleMessageExpanded(0);
      const finalState = states[states.length - 1];
      expect(finalState?.replayMessages[0]?.expanded).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Scrubber
  // -----------------------------------------------------------------------

  describe('setScrubberPosition()', () => {
    it('clamps scrubber position to valid range', async () => {
      const states: SessionStreamState[] = [];
      presenter = makePresenter({ onChange: (s) => states.push(s) });

      const messages: ContentMessage[] = [
        { type: 'human', content: 'A' },
        { type: 'assistant', content: 'B' },
        { type: 'assistant', content: 'C' },
      ];
      mocks.fetch.mockResolvedValueOnce(makeJsonResponse({ messages }));
      await presenter.loadReplay('s1', 'm1');

      // Try to go beyond the end
      presenter.setScrubberPosition(999);
      let lastState = states[states.length - 1];
      expect(lastState?.scrubberPosition).toBe(2);

      // Try to go before the start
      presenter.setScrubberPosition(-5);
      lastState = states[states.length - 1];
      expect(lastState?.scrubberPosition).toBe(0);

      // Valid position
      presenter.setScrubberPosition(1);
      lastState = states[states.length - 1];
      expect(lastState?.scrubberPosition).toBe(1);
    });
  });
});
