import type { Agent, AgentEvent, AgentRun } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileClientError } from '../services/api-client.js';
import type { AgentDetailState } from './agent-detail-presenter.js';
import { AgentDetailPresenter } from './agent-detail-presenter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'manual',
    status: 'running',
    schedule: null,
    projectPath: null,
    worktreeBranch: null,
    currentSessionId: null,
    config: {},
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    createdAt: new Date('2024-01-01'),
    ...partial,
  };
}

function makeRun(partial: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    trigger: 'manual',
    status: 'success',
    startedAt: new Date('2024-01-01T10:00:00Z'),
    finishedAt: new Date('2024-01-01T10:05:00Z'),
    costUsd: 0.05,
    tokensIn: 1000,
    tokensOut: 500,
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    sessionId: 'sess-1',
    errorMessage: null,
    resultSummary: 'completed',
    ...partial,
  };
}

function makeApiClient(overrides: Record<string, unknown> = {}) {
  return {
    getAgent: vi.fn().mockResolvedValue(makeAgent()),
    getAgentRuns: vi.fn().mockResolvedValue([makeRun()]),
    startAgent: vi.fn().mockResolvedValue({ ok: true, agentId: 'agent-1', jobId: 'j1' }),
    stopAgent: vi
      .fn()
      .mockResolvedValue({ ok: true, agentId: 'agent-1', reason: 'user', graceful: true }),
    signalAgent: vi.fn().mockResolvedValue({ ok: true, agentId: 'agent-1', jobId: 'j2' }),
    ...overrides,
  };
}

type SseHandler = (data: unknown) => void;

function makeSseClient() {
  const handlers: Record<string, SseHandler[]> = {};
  return {
    on: vi.fn((event: string, handler: SseHandler) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: SseHandler) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    }),
    connect: vi.fn(),
    close: vi.fn(),
    /** Test helper: emit a synthetic event to registered handlers. */
    _emit(event: string, data: unknown) {
      for (const handler of handlers[event] ?? []) {
        handler(data);
      }
    },
    _handlers: handlers,
  };
}

function makeOutputEvent(content: string): AgentEvent {
  return { event: 'output', data: { type: 'text', content } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentDetailPresenter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('returns empty state before loading', () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      const state = presenter.getState();

      expect(state.agent).toBeNull();
      expect(state.runs).toEqual([]);
      expect(state.latestRunSummary).toBeNull();
      expect(state.outputLines).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.isStreaming).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastUpdated).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Loading agent
  // -------------------------------------------------------------------------

  describe('loadAgent', () => {
    it('fetches agent details and runs', async () => {
      const agent = makeAgent({ name: 'my-agent' });
      const runs = [makeRun(), makeRun({ id: 'run-2' })];

      const api = makeApiClient({
        getAgent: vi.fn().mockResolvedValue(agent),
        getAgentRuns: vi.fn().mockResolvedValue(runs),
      });
      const sse = makeSseClient();

      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');
      const state = presenter.getState();

      expect(state.agent).toEqual(agent);
      expect(state.runs).toEqual(runs);
      expect(state.isLoading).toBe(false);
      expect(state.lastUpdated).toEqual(new Date('2024-06-15T12:00:00Z'));
    });

    it('derives latestRunSummary from the newest run that has structured summary data', async () => {
      const api = makeApiClient({
        getAgentRuns: vi.fn().mockResolvedValue([
          makeRun({
            id: 'run-structured',
            resultSummary: {
              status: 'success',
              workCompleted: 'Implemented summary UI.',
              executiveSummary: 'Implemented summary UI.',
              keyFindings: ['Latest run summary is surfaced in mobile state.'],
              filesChanged: [],
              commandsRun: 1,
              toolUsageBreakdown: { Edit: 1 },
              followUps: [],
              branchName: null,
              prUrl: null,
              tokensUsed: { input: 100, output: 20 },
              costUsd: 0.01,
              durationMs: 5_000,
            },
          }),
        ]),
      });
      const sse = makeSseClient();

      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      await presenter.loadAgent('agent-1');
      const state = presenter.getState();

      expect(state.latestRunSummary).toMatchObject({
        workCompleted: 'Implemented summary UI.',
        executiveSummary: 'Implemented summary UI.',
      });
    });

    it('passes maxRuns limit to getAgentRuns', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
        maxRuns: 5,
      });

      await presenter.loadAgent('agent-1');
      expect(api.getAgentRuns).toHaveBeenCalledWith('agent-1', 5);
    });

    it('sets isLoading=true during load', () => {
      const states: boolean[] = [];
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
        onChange: (s: AgentDetailState) => states.push(s.isLoading),
      });

      void presenter.loadAgent('agent-1');
      expect(states[0]).toBe(true);
    });

    it('sets error on load failure', async () => {
      const api = makeApiClient({
        getAgent: vi.fn().mockRejectedValue(new MobileClientError('NOT_FOUND', 'Agent not found')),
      });
      const sse = makeSseClient();

      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('missing');
      const state = presenter.getState();

      expect(state.error?.code).toBe('NOT_FOUND');
      expect(state.isLoading).toBe(false);
    });

    it('wraps non-MobileClientError on load failure', async () => {
      const api = makeApiClient({
        getAgent: vi.fn().mockRejectedValue(new TypeError('boom')),
      });
      const sse = makeSseClient();

      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('bad');
      const state = presenter.getState();

      expect(state.error?.code).toBe('AGENT_LOAD_FAILED');
      expect(state.error?.message).toBe('boom');
    });
  });

  // -------------------------------------------------------------------------
  // Refresh agent
  // -------------------------------------------------------------------------

  describe('refreshAgent', () => {
    it('updates agent details without affecting runs', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();

      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      const updatedAgent = makeAgent({ status: 'stopped' });
      api.getAgent.mockResolvedValueOnce(updatedAgent);

      await presenter.refreshAgent();
      const state = presenter.getState();

      expect(state.agent?.status).toBe('stopped');
      // Runs should remain from initial load
      expect(state.runs).toHaveLength(1);
    });

    it('does nothing if no agent loaded', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      await presenter.refreshAgent();
      expect(api.getAgent).not.toHaveBeenCalled();
    });

    it('handles refresh errors', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      api.getAgent.mockRejectedValueOnce(new Error('timeout'));
      await presenter.refreshAgent();

      const state = presenter.getState();
      expect(state.error?.code).toBe('AGENT_REFRESH_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // Start / Stop / Signal
  // -------------------------------------------------------------------------

  describe('startAgent', () => {
    it('starts the agent and refreshes', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      const result = await presenter.startAgent('fix the bug', 'claude-sonnet-4-20250514');

      expect(result.ok).toBe(true);
      expect(api.startAgent).toHaveBeenCalledWith('agent-1', {
        prompt: 'fix the bug',
        model: 'claude-sonnet-4-20250514',
      });
      // Should refresh after start
      expect(api.getAgent).toHaveBeenCalledTimes(2);
    });

    it('throws when no agent is loaded', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      await expect(presenter.startAgent('test')).rejects.toThrow(MobileClientError);
    });
  });

  describe('stopAgent', () => {
    it('stops the agent and refreshes', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      const result = await presenter.stopAgent();

      expect(result.ok).toBe(true);
      expect(api.stopAgent).toHaveBeenCalledWith('agent-1', 'user', true);
    });

    it('passes custom reason and graceful flag', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      await presenter.stopAgent('timeout', false);
      expect(api.stopAgent).toHaveBeenCalledWith('agent-1', 'timeout', false);
    });

    it('throws when no agent is loaded', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      await expect(presenter.stopAgent()).rejects.toThrow(MobileClientError);
    });
  });

  describe('signalAgent', () => {
    it('sends signal to the agent', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      const result = await presenter.signalAgent('check status', { env: 'prod' });

      expect(result.ok).toBe(true);
      expect(api.signalAgent).toHaveBeenCalledWith('agent-1', {
        prompt: 'check status',
        metadata: { env: 'prod' },
      });
    });

    it('throws when no agent is loaded', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      await expect(presenter.signalAgent('test')).rejects.toThrow(MobileClientError);
    });
  });

  // -------------------------------------------------------------------------
  // SSE streaming
  // -------------------------------------------------------------------------

  describe('startStreaming', () => {
    it('connects SSE client to the agent', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      presenter.startStreaming();

      expect(sse.connect).toHaveBeenCalledWith('agent-1');
      expect(sse.on).toHaveBeenCalled();
    });

    it('throws when no agent is loaded', () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      expect(() => presenter.startStreaming()).toThrow(MobileClientError);
    });

    it('sets isStreaming=true on SSE open event', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      presenter.startStreaming();
      sse._emit('open', undefined);

      expect(presenter.getState().isStreaming).toBe(true);
    });

    it('sets isStreaming=false on SSE close event', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      presenter.startStreaming();
      sse._emit('open', undefined);
      expect(presenter.getState().isStreaming).toBe(true);

      sse._emit('close', undefined);
      expect(presenter.getState().isStreaming).toBe(false);
    });

    it('sets error on SSE error event', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      presenter.startStreaming();
      sse._emit('error', new Error('connection lost'));

      const state = presenter.getState();
      expect(state.error?.code).toBe('SSE_ERROR');
      expect(state.error?.message).toBe('connection lost');
    });
  });

  // -------------------------------------------------------------------------
  // Output buffering
  // -------------------------------------------------------------------------

  describe('output buffering', () => {
    it('appends output lines from SSE events', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');
      presenter.startStreaming();

      sse._emit('event', makeOutputEvent('line 1'));
      sse._emit('event', makeOutputEvent('line 2'));

      const state = presenter.getState();
      expect(state.outputLines).toHaveLength(2);
      expect(state.outputLines[0].lineNumber).toBe(1);
      expect(state.outputLines[1].lineNumber).toBe(2);
    });

    it('assigns monotonically increasing line numbers', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');
      presenter.startStreaming();

      for (let i = 0; i < 5; i++) {
        sse._emit('event', makeOutputEvent(`line ${i}`));
      }

      const lines = presenter.getState().outputLines;
      for (let i = 0; i < 5; i++) {
        expect(lines[i].lineNumber).toBe(i + 1);
      }
    });

    it('trims output to maxOutputLines', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
        maxOutputLines: 3,
      });
      await presenter.loadAgent('agent-1');
      presenter.startStreaming();

      for (let i = 1; i <= 5; i++) {
        sse._emit('event', makeOutputEvent(`line ${i}`));
      }

      const state = presenter.getState();
      expect(state.outputLines).toHaveLength(3);
      // Should keep the most recent 3 lines
      expect(state.outputLines[0].lineNumber).toBe(3);
      expect(state.outputLines[1].lineNumber).toBe(4);
      expect(state.outputLines[2].lineNumber).toBe(5);
    });

    it('stores the event and receivedAt in each line', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');
      presenter.startStreaming();

      const event = makeOutputEvent('hello');
      sse._emit('event', event);

      const line = presenter.getState().outputLines[0];
      expect(line.event).toEqual(event);
      expect(line.receivedAt).toEqual(new Date('2024-06-15T12:00:00Z'));
    });

    it('clearOutput resets lines and counter', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');
      presenter.startStreaming();

      sse._emit('event', makeOutputEvent('line 1'));
      sse._emit('event', makeOutputEvent('line 2'));
      expect(presenter.getState().outputLines).toHaveLength(2);

      presenter.clearOutput();
      expect(presenter.getState().outputLines).toHaveLength(0);

      // Next line should start at 1 again
      sse._emit('event', makeOutputEvent('line after clear'));
      expect(presenter.getState().outputLines[0].lineNumber).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Stop streaming
  // -------------------------------------------------------------------------

  describe('stopStreaming', () => {
    it('closes SSE client and removes handlers', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      presenter.startStreaming();
      presenter.stopStreaming();

      expect(sse.close).toHaveBeenCalled();
      expect(sse.off).toHaveBeenCalled();
      expect(presenter.getState().isStreaming).toBe(false);
    });

    it('is safe to call without starting', () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });

      // Should not throw
      presenter.stopStreaming();
      expect(sse.close).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Destroy
  // -------------------------------------------------------------------------

  describe('destroy', () => {
    it('stops streaming and resets all state', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');
      presenter.startStreaming();
      sse._emit('event', makeOutputEvent('data'));

      presenter.destroy();

      const state = presenter.getState();
      expect(state.agent).toBeNull();
      expect(state.runs).toEqual([]);
      expect(state.outputLines).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(sse.close).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onChange callback
  // -------------------------------------------------------------------------

  describe('onChange callback', () => {
    it('fires on state changes', async () => {
      const onChange = vi.fn();
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
        onChange,
      });

      await presenter.loadAgent('agent-1');
      // loading=true, then final state
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('fires on each SSE event', async () => {
      const onChange = vi.fn();
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
        onChange,
      });
      await presenter.loadAgent('agent-1');
      onChange.mockClear();

      presenter.startStreaming();
      sse._emit('event', makeOutputEvent('hello'));
      sse._emit('event', makeOutputEvent('world'));

      expect(onChange).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  describe('immutability', () => {
    it('getState returns new objects each time', async () => {
      const api = makeApiClient();
      const sse = makeSseClient();
      const presenter = new AgentDetailPresenter({
        apiClient: api as never,
        sseClient: sse as never,
      });
      await presenter.loadAgent('agent-1');

      const s1 = presenter.getState();
      const s2 = presenter.getState();

      expect(s1).not.toBe(s2);
      expect(s1.outputLines).not.toBe(s2.outputLines);
      expect(s1.runs).not.toBe(s2.runs);
    });
  });
});
