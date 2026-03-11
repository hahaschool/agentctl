import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionStreamEvent } from './use-session-stream';
import { useSessionStream } from './use-session-stream';

// ---------------------------------------------------------------------------
// Minimal EventSource mock
// ---------------------------------------------------------------------------

type EsListener = (event: MessageEvent) => void;
type ErrorListener = () => void;

class MockEventSource {
  url: string;
  onopen: (() => void) | null = null;
  onerror: ErrorListener | null = null;

  private listeners: Record<string, EsListener[]> = {};

  static instances: MockEventSource[] = [];

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: EsListener) {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: EsListener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn);
  }

  close = vi.fn();

  // Simulate server events:
  simulateOpen() {
    this.onopen?.();
  }

  simulateError() {
    this.onerror?.();
  }

  simulateEvent(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners[type] ?? []) {
      fn(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function latestEs(): MockEventSource {
  const es = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!es) throw new Error('No EventSource was created');
  return es;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useSessionStream — initial state', () => {
  it('starts disconnected with empty output', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    expect(result.current.connected).toBe(false);
    expect(result.current.streamOutput).toEqual([]);
    expect(result.current.latestStatus).toBeNull();
    expect(result.current.latestCost).toBeNull();
    expect(result.current.latestExecutionSummary).toBeNull();
  });

  it('does not create an EventSource when enabled is false', () => {
    renderHook(() => useSessionStream({ sessionId: 'sess-1', enabled: false }));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('does not create an EventSource when sessionId is empty', () => {
    renderHook(() => useSessionStream({ sessionId: '' }));
    expect(MockEventSource.instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe('useSessionStream — connection lifecycle', () => {
  it('creates an EventSource with the correct URL on mount', () => {
    renderHook(() => useSessionStream({ sessionId: 'abc-123' }));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(latestEs().url).toContain('/api/sessions/abc-123/stream');
  });

  it('URL-encodes special characters in sessionId', () => {
    renderHook(() => useSessionStream({ sessionId: 'session/with/slashes' }));

    expect(latestEs().url).toContain('session%2Fwith%2Fslashes');
  });

  it('sets connected to true when EventSource opens', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });

    expect(result.current.connected).toBe(true);
  });

  it('sets connected to false on error', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateError();
    });

    expect(result.current.connected).toBe(false);
  });

  it('closes the EventSource on unmount', () => {
    const { unmount } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));
    const es = latestEs();

    unmount();

    expect(es.close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Event handling — output
// ---------------------------------------------------------------------------

describe('useSessionStream — output events', () => {
  it('accumulates text from output events', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('output', { text: 'Hello, ' });
    });
    act(() => {
      latestEs().simulateEvent('output', { text: 'world!' });
    });

    expect(result.current.streamOutput).toEqual(['Hello, ', 'world!']);
  });

  it('ignores output events with no text field', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('output', { stream: 'stderr' });
    });

    expect(result.current.streamOutput).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Event handling — status
// ---------------------------------------------------------------------------

describe('useSessionStream — status events', () => {
  it('updates latestStatus from status events', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('status', { status: 'running' });
    });

    expect(result.current.latestStatus).toBe('running');
  });

  it('overwrites latestStatus on subsequent status events', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('status', { status: 'running' });
    });
    act(() => {
      latestEs().simulateEvent('status', { status: 'idle' });
    });

    expect(result.current.latestStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Event handling — cost
// ---------------------------------------------------------------------------

describe('useSessionStream — cost events', () => {
  it('updates latestCost from cost events', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });

    const costData = { totalCostUsd: 0.05, inputTokens: 1000, outputTokens: 200 };
    act(() => {
      latestEs().simulateEvent('cost', costData);
    });

    expect(result.current.latestCost).toEqual(costData);
  });

  it('overwrites latestCost on subsequent cost events', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });

    act(() => {
      latestEs().simulateEvent('cost', { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50 });
    });
    act(() => {
      latestEs().simulateEvent('cost', {
        totalCostUsd: 0.99,
        inputTokens: 5000,
        outputTokens: 1000,
      });
    });

    expect(result.current.latestCost?.totalCostUsd).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// Event handling — execution summary
// ---------------------------------------------------------------------------

describe('useSessionStream — execution summary events', () => {
  it('updates latestExecutionSummary from execution_summary events', () => {
    const { result } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });

    const summary = {
      status: 'success' as const,
      workCompleted: 'Rendered the latest execution summary live.',
      executiveSummary: 'Rendered the latest execution summary live.',
      keyFindings: ['Session detail view no longer waits for a full refresh.'],
      filesChanged: [],
      commandsRun: 2,
      toolUsageBreakdown: { Edit: 1, Bash: 1 },
      followUps: [],
      branchName: null,
      prUrl: null,
      tokensUsed: { input: 100, output: 25 },
      costUsd: 0.08,
      durationMs: 3_500,
    };

    act(() => {
      latestEs().simulateEvent('execution_summary', { summary });
    });

    expect(result.current.latestExecutionSummary).toEqual(summary);
  });
});

// ---------------------------------------------------------------------------
// onEvent callback
// ---------------------------------------------------------------------------

describe('useSessionStream — onEvent callback', () => {
  it('calls onEvent for output events', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('output', { text: 'test output' });
    });

    expect(onEvent).toHaveBeenCalledOnce();
    const received = onEvent.mock.calls[0]?.[0] as SessionStreamEvent;
    expect(received.event).toBe('output');
    if (received.event === 'output') {
      expect(received.data.text).toBe('test output');
    }
  });

  it('calls onEvent for status events', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('status', { status: 'running' });
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      event: 'status',
      data: { status: 'running' },
    });
  });

  it('calls onEvent for approval_needed events', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('approval_needed', { toolName: 'Bash', args: { command: 'ls' } });
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ event: 'approval_needed' });
  });

  it('calls onEvent for loop_iteration events', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('loop_iteration', { iteration: 3 });
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'loop_iteration', data: { iteration: 3 } }),
    );
  });

  it('calls onEvent for loop_complete events', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('loop_complete', { reason: 'max_iterations' });
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'loop_complete', data: { reason: 'max_iterations' } }),
    );
  });

  it('calls onEvent for execution_summary events', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('execution_summary', {
        summary: {
          status: 'success',
          workCompleted: 'Live summary arrived.',
          executiveSummary: 'Live summary arrived.',
          keyFindings: [],
          filesChanged: [],
          commandsRun: 1,
          toolUsageBreakdown: { Edit: 1 },
          followUps: [],
          branchName: null,
          prUrl: null,
          tokensUsed: { input: 10, output: 5 },
          costUsd: 0.01,
          durationMs: 500,
        },
      });
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'execution_summary' }));
  });

  it('ignores events with invalid JSON', () => {
    const onEvent = vi.fn();
    renderHook(() => useSessionStream({ sessionId: 'sess-1', onEvent }));

    act(() => {
      latestEs().simulateOpen();
    });

    // Fire a raw malformed message directly on the listener.
    const es = latestEs();
    const badEvent = { data: 'NOT JSON {{{{' } as MessageEvent;
    act(() => {
      const listeners =
        (es as unknown as { listeners: Record<string, EsListener[]> }).listeners.output ?? [];
      for (const fn of listeners) {
        fn(badEvent);
      }
    });

    expect(onEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// State reset on sessionId change
// ---------------------------------------------------------------------------

describe('useSessionStream — state reset', () => {
  it('resets streamOutput when sessionId changes', () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionStream({ sessionId }),
      { initialProps: { sessionId: 'sess-1' } },
    );

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('output', { text: 'old output' });
    });

    expect(result.current.streamOutput).toEqual(['old output']);

    rerender({ sessionId: 'sess-2' });

    // State resets immediately on the new session.
    expect(result.current.streamOutput).toEqual([]);
  });

  it('resets latestStatus when sessionId changes', () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionStream({ sessionId }),
      { initialProps: { sessionId: 'sess-1' } },
    );

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('status', { status: 'running' });
    });

    expect(result.current.latestStatus).toBe('running');

    rerender({ sessionId: 'sess-2' });

    expect(result.current.latestStatus).toBeNull();
  });

  it('resets latestExecutionSummary when sessionId changes', () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionStream({ sessionId }),
      { initialProps: { sessionId: 'sess-1' } },
    );

    act(() => {
      latestEs().simulateOpen();
    });
    act(() => {
      latestEs().simulateEvent('execution_summary', {
        summary: {
          status: 'success',
          workCompleted: 'Old summary',
          executiveSummary: 'Old summary',
          keyFindings: [],
          filesChanged: [],
          commandsRun: 0,
          toolUsageBreakdown: {},
          followUps: [],
          branchName: null,
          prUrl: null,
          tokensUsed: { input: 0, output: 0 },
          costUsd: 0,
          durationMs: 0,
        },
      });
    });

    expect(result.current.latestExecutionSummary?.executiveSummary).toBe('Old summary');

    rerender({ sessionId: 'sess-2' });

    expect(result.current.latestExecutionSummary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------

describe('useSessionStream — reconnection', () => {
  it('schedules a reconnect with backoff after an error', () => {
    renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });

    const countBefore = MockEventSource.instances.length;

    act(() => {
      latestEs().simulateError();
    });

    // Advance past the initial reconnect delay.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(MockEventSource.instances.length).toBeGreaterThan(countBefore);
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = renderHook(() => useSessionStream({ sessionId: 'sess-1' }));

    act(() => {
      latestEs().simulateOpen();
    });

    const countBefore = MockEventSource.instances.length;

    // Trigger error before unmounting to schedule a reconnect timer.
    act(() => {
      latestEs().simulateError();
    });

    unmount();

    // Advance timers — no new connection should be created.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(MockEventSource.instances.length).toBe(countBefore);
  });
});
