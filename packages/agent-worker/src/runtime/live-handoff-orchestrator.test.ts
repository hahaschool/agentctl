import type {
  AgentEvent,
  AutoHandoffPolicy,
  CostThresholdHandoffEvent,
  CostThresholdWarningEvent,
  RateLimitHandoffEvent,
} from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import type { HandoffController, HandoffExecutionResult } from './handoff-controller.js';
import { LiveHandoffOrchestrator } from './live-handoff-orchestrator.js';

function makePolicy(overrides?: {
  rateLimitFailover?: Partial<AutoHandoffPolicy['rateLimitFailover']>;
  costThreshold?: Partial<AutoHandoffPolicy['costThreshold']>;
}): AutoHandoffPolicy {
  return {
    enabled: true,
    mode: 'execute',
    maxAutomaticHandoffsPerRun: 2,
    cooldownMs: 0,
    rateLimitFailover: {
      enabled: true,
      targetRuntimeOrder: ['claude-code', 'codex'],
      retryBudget: 0,
      ...overrides?.rateLimitFailover,
    },
    costThreshold: {
      enabled: true,
      thresholdUsd: 5.0,
      targetRuntime: 'codex',
      minRemainingWorkSignal: 'best-effort',
      ...overrides?.costThreshold,
    },
  };
}

function makeMockHandoffController(): HandoffController {
  const mockResult: HandoffExecutionResult = {
    ok: true,
    strategy: 'snapshot-handoff',
    attemptedStrategies: ['snapshot-handoff'],
    snapshot: {
      sourceRuntime: 'claude-code',
      sourceSessionId: 'sess-1',
      sourceNativeSessionId: 'native-1',
      projectPath: '/tmp/project',
      worktreePath: null,
      branch: 'main',
      headSha: 'abc123',
      dirtyFiles: [],
      diffSummary: '',
      conversationSummary: 'test',
      openTodos: [],
      nextSuggestedPrompt: 'Continue.',
      activeConfigRevision: undefined,
      activeMcpServers: [],
      activeSkills: [],
      reason: 'rate_limit',
    },
    session: {
      runtime: 'codex',
      sessionId: 'new-sess',
      nativeSessionId: 'new-native',
      agentId: 'agent-1',
      projectPath: '/tmp/project',
      model: 'gpt-4',
      status: 'active',
      pid: 1234,
      startedAt: new Date(),
      lastActivity: null,
    },
  };

  return {
    exportSnapshot: vi.fn().mockResolvedValue(mockResult.snapshot),
    handoff: vi.fn().mockResolvedValue(mockResult),
    pickStrategies: vi.fn().mockReturnValue(['snapshot-handoff']),
    preflightNativeImport: vi.fn(),
  } as unknown as HandoffController;
}

describe('LiveHandoffOrchestrator', () => {
  describe('rate-limit detection', () => {
    it('triggers handoff after rate-limit retry budget is exhausted', async () => {
      const events: AgentEvent[] = [];
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({ rateLimitFailover: { retryBudget: 0 } }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: (event) => events.push(event),
      });

      const result = orchestrator.observeError({ statusCode: 429, message: 'Too Many Requests' });
      expect(result).toBe(true);

      // Wait for async handoff execution
      await vi.waitFor(() => {
        expect(handoffController.exportSnapshot).toHaveBeenCalledOnce();
      });

      expect(handoffController.handoff).toHaveBeenCalledOnce();

      // Should have emitted the rate_limit_handoff SSE event
      const handoffEvent = events.find((e) => e.event === 'rate_limit_handoff') as
        | RateLimitHandoffEvent
        | undefined;
      expect(handoffEvent).toBeDefined();
      expect(handoffEvent?.data.sourceRuntime).toBe('claude-code');
      expect(handoffEvent?.data.targetRuntime).toBe('codex');
    });

    it('does not trigger when policy is disabled', () => {
      const events: AgentEvent[] = [];
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({
          rateLimitFailover: { enabled: false },
        }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: (event) => events.push(event),
      });

      const result = orchestrator.observeError({ statusCode: 429 });
      expect(result).toBe(false);
      expect(handoffController.exportSnapshot).not.toHaveBeenCalled();
    });

    it('ignores non-rate-limit errors', () => {
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy(),
        handoffController,
        logger: createMockLogger(),
        emitEvent: vi.fn(),
      });

      const result = orchestrator.observeError({
        statusCode: 500,
        message: 'Internal Server Error',
      });
      expect(result).toBe(false);
    });

    it('does not trigger again after handoff is already completed', async () => {
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({ rateLimitFailover: { retryBudget: 0 } }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: vi.fn(),
      });

      orchestrator.observeError({ statusCode: 429 });

      // Wait for handoff completion
      await vi.waitFor(() => {
        expect(orchestrator.isHandoffTriggered()).toBe(true);
      });

      // Second error should not trigger another handoff
      const secondResult = orchestrator.observeError({ statusCode: 429 });
      expect(secondResult).toBe(false);
    });
  });

  describe('cost-threshold monitoring', () => {
    it('emits warning at 80% and triggers handoff when threshold is exceeded', async () => {
      const events: AgentEvent[] = [];
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({ costThreshold: { thresholdUsd: 10.0 } }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: (event) => events.push(event),
      });

      // Below 80% — nothing
      expect(orchestrator.observeCostUpdate(5.0)).toBe(null);

      // At 80% — warning
      expect(orchestrator.observeCostUpdate(8.0)).toBe('warning');
      const warningEvent = events.find((e) => e.event === 'cost_threshold_warning') as
        | CostThresholdWarningEvent
        | undefined;
      expect(warningEvent).toBeDefined();
      expect(warningEvent?.data.fraction).toBeCloseTo(0.8);

      // Exceed threshold — handoff
      expect(orchestrator.observeCostUpdate(10.1)).toBe('handoff');

      await vi.waitFor(() => {
        expect(handoffController.exportSnapshot).toHaveBeenCalledOnce();
      });

      const handoffEvent = events.find((e) => e.event === 'cost_threshold_handoff') as
        | CostThresholdHandoffEvent
        | undefined;
      expect(handoffEvent).toBeDefined();
      expect(handoffEvent?.data.sourceRuntime).toBe('claude-code');
      expect(handoffEvent?.data.targetRuntime).toBe('codex');
    });

    it('does not trigger when cost threshold is disabled', () => {
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({
          costThreshold: { enabled: false },
        }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: vi.fn(),
      });

      expect(orchestrator.observeCostUpdate(100.0)).toBe(null);
      expect(handoffController.exportSnapshot).not.toHaveBeenCalled();
    });

    it('does not trigger cost handoff if rate-limit handoff already fired', async () => {
      const handoffController = makeMockHandoffController();

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({
          rateLimitFailover: { retryBudget: 0 },
          costThreshold: { thresholdUsd: 5.0 },
        }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: vi.fn(),
      });

      // Trigger rate-limit handoff first
      orchestrator.observeError({ statusCode: 429 });

      await vi.waitFor(() => {
        expect(orchestrator.isHandoffTriggered()).toBe(true);
      });

      // Cost threshold should be suppressed
      expect(orchestrator.observeCostUpdate(10.0)).toBe(null);
    });
  });

  describe('handoff error handling', () => {
    it('emits error output event when handoff fails', async () => {
      const events: AgentEvent[] = [];
      const handoffController = makeMockHandoffController();
      (handoffController.exportSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Snapshot export failed'),
      );

      const orchestrator = new LiveHandoffOrchestrator({
        sourceRuntime: 'claude-code',
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        policy: makePolicy({ rateLimitFailover: { retryBudget: 0 } }),
        handoffController,
        logger: createMockLogger(),
        emitEvent: (event) => events.push(event),
      });

      orchestrator.observeError({ statusCode: 429 });

      await vi.waitFor(() => {
        const errorEvent = events.find(
          (e) =>
            e.event === 'output' &&
            e.data.type === 'text' &&
            e.data.content.includes('[handoff_error]'),
        );
        expect(errorEvent).toBeDefined();
      });

      // After failure, handoffInProgress should be reset
      expect(orchestrator.isHandoffTriggered()).toBe(false);
    });
  });
});
