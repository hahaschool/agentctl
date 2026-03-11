import type { AgentConfig, AgentEvent } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { EventedAgentOutputStream } from './agent-output-stream.js';
import type { SdkRunnerOptions } from './sdk-runner.js';

// ── Helpers ───────────────────────────────────────────────────────────

const mockLogger = createMockLogger();

function makeOutputStream(onEvent = vi.fn()) {
  return {
    onEvent,
    outputStream: new EventedAgentOutputStream(onEvent),
  };
}

function makeOptions(overrides?: Partial<SdkRunnerOptions>): SdkRunnerOptions {
  const { outputStream } = makeOutputStream();
  return {
    prompt: 'Write a hello world function',
    agentId: 'agent-1',
    sessionId: 'session-1',
    config: {} as AgentConfig,
    projectPath: '/tmp/test-project',
    logger: mockLogger,
    outputStream,
    ...overrides,
  };
}

/**
 * Helper to create an async iterable from an array of messages.
 * Simulates the streaming message shape returned by the SDK's `query()`.
 */
async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('sdk-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('loadSdk (via runWithSdk fallback path)', () => {
    it('returns null when SDK is not installed', async () => {
      // Mock the SDK to simulate an import failure (SDK not installed).
      vi.doMock('@anthropic-ai/claude-agent-sdk', () => {
        throw new Error('Cannot find module');
      });

      const { runWithSdk } = await import('./sdk-runner.js');

      const result = await runWithSdk(makeOptions());

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Claude Agent SDK not installed, cannot run real agent',
      );
    });
  });

  describe('runWithSdk with mocked SDK', () => {
    it('processes SDK messages and returns aggregated result', async () => {
      const messages: Record<string, unknown>[] = [
        { type: 'assistant', content: 'I will create a function' },
        {
          type: 'tool_use',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/hello.ts', content: 'export const hello = () => "hi";' },
        },
        { type: 'tool_result', content: 'File written successfully' },
        {
          type: 'assistant',
          content: 'Done!',
          usage: { input_tokens: 500, output_tokens: 100 },
          turn_cost_usd: 0.003,
          total_cost_usd: 0.003,
        },
        {
          type: 'result',
          result: 'Created hello world function',
          session_id: 'session-from-sdk',
          total_cost_usd: 0.005,
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const { onEvent, outputStream } = makeOutputStream();
      const result = await runWithSdk(makeOptions({ outputStream }));

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('session-from-sdk');
      expect(result?.costUsd).toBe(0.005);
      expect(result?.tokensIn).toBe(1000);
      expect(result?.tokensOut).toBe(200);
      expect(result?.result).toBe('Created hello world function');

      // Verify events were emitted
      const outputEvents = onEvent.mock.calls
        .map((call: unknown[]) => call[0] as AgentEvent)
        .filter((e: AgentEvent) => e.event === 'output');

      expect(outputEvents.length).toBeGreaterThanOrEqual(3);

      // Check first output event is the assistant text
      expect(outputEvents[0].data).toEqual({
        type: 'text',
        content: 'I will create a function',
      });

      // Check tool_use event
      const toolUseEvent = outputEvents.find(
        (e: AgentEvent) => e.event === 'output' && e.data.type === 'tool_use',
      );
      expect(toolUseEvent).toBeDefined();

      // Check tool_result event
      const toolResultEvent = outputEvents.find(
        (e: AgentEvent) => e.event === 'output' && e.data.type === 'tool_result',
      );
      expect(toolResultEvent).toBeDefined();

      // Check cost event was emitted
      const costEvents = onEvent.mock.calls
        .map((call: unknown[]) => call[0] as AgentEvent)
        .filter((e: AgentEvent) => e.event === 'cost');

      expect(costEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('calls preToolUse hook and blocks denied tools', async () => {
      const messages: Record<string, unknown>[] = [
        {
          type: 'tool_use',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf /' },
        },
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const { onEvent, outputStream } = makeOutputStream();
      const preToolUse = vi.fn().mockResolvedValue('deny');

      const result = await runWithSdk(
        makeOptions({
          outputStream,
          hooks: { preToolUse },
        }),
      );

      expect(result).not.toBeNull();

      // preToolUse should have been called
      expect(preToolUse).toHaveBeenCalledTimes(1);
      expect(preToolUse).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'Bash',
          toolInput: { command: 'rm -rf /' },
        }),
      );

      // A tool_blocked event should have been emitted
      const blockedEvents = onEvent.mock.calls
        .map((call: unknown[]) => call[0] as AgentEvent)
        .filter((e: AgentEvent) => e.event === 'output' && e.data.type === 'tool_blocked');

      expect(blockedEvents.length).toBe(1);
    });

    it('calls postToolUse hook after tool_result', async () => {
      const messages: Record<string, unknown>[] = [
        {
          type: 'tool_use',
          tool_name: 'Read',
          tool_input: { file_path: '/tmp/test.ts' },
        },
        { type: 'tool_result', content: 'file contents here' },
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const preToolUse = vi.fn().mockResolvedValue('allow');
      const postToolUse = vi.fn().mockResolvedValue(undefined);

      await runWithSdk(
        makeOptions({
          hooks: { preToolUse, postToolUse },
        }),
      );

      expect(postToolUse).toHaveBeenCalledTimes(1);
      expect(postToolUse).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'Read',
          toolInput: { file_path: '/tmp/test.ts' },
          toolOutput: 'file contents here',
        }),
      );

      // durationMs should be a non-negative number
      const callArgs = postToolUse.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof callArgs.durationMs).toBe('number');
      expect(callArgs.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('calls stop hook on successful completion', async () => {
      const messages: Record<string, unknown>[] = [
        { type: 'assistant', content: 'All done' },
        { type: 'result', result: 'Completed', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const stopHook = vi.fn().mockResolvedValue(undefined);

      await runWithSdk(
        makeOptions({
          hooks: { stop: stopHook },
        }),
      );

      expect(stopHook).toHaveBeenCalledTimes(1);
      expect(stopHook).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          agentId: 'agent-1',
          reason: 'completed',
        }),
      );
    });

    it('throws AgentError and calls stop hook on SDK error', async () => {
      async function* failingIterable(): AsyncIterable<Record<string, unknown>> {
        yield { type: 'assistant', content: 'Starting...' };
        throw new Error('SDK crashed unexpectedly');
      }

      const mockQuery = vi.fn().mockReturnValue(failingIterable());

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const stopHook = vi.fn().mockResolvedValue(undefined);

      await expect(
        runWithSdk(
          makeOptions({
            hooks: { stop: stopHook },
          }),
        ),
      ).rejects.toThrow('Agent SDK run failed: SDK crashed unexpectedly');

      // Stop hook should still be called on error
      expect(stopHook).toHaveBeenCalledTimes(1);
      expect(stopHook).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.stringContaining('error:'),
        }),
      );
    });

    it('handles abort signal during iteration', async () => {
      const controller = new AbortController();

      async function* slowIterable(): AsyncIterable<Record<string, unknown>> {
        yield { type: 'assistant', content: 'Turn 1' };
        // Signal abort before next message
        controller.abort();
        yield { type: 'assistant', content: 'Turn 2 (should not be processed)' };
      }

      const mockQuery = vi.fn().mockReturnValue(slowIterable());

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const { outputStream } = makeOutputStream();
      const stopHook = vi.fn().mockResolvedValue(undefined);

      const result = await runWithSdk(
        makeOptions({
          outputStream,
          abortSignal: controller.signal,
          hooks: { stop: stopHook },
        }),
      );

      expect(result).not.toBeNull();

      // Stop hook should receive 'aborted' reason
      expect(stopHook).toHaveBeenCalledWith(expect.objectContaining({ reason: 'aborted' }));
    });

    it('builds correct SDK options from AgentConfig', async () => {
      const config: AgentConfig = {
        model: 'opus',
        maxTurns: 10,
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write'],
        disallowedTools: ['Bash'],
        systemPrompt: 'You are a helpful agent.',
      };

      const messages: Record<string, unknown>[] = [
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      await runWithSdk(makeOptions({ config }));

      expect(mockQuery).toHaveBeenCalledTimes(1);

      const callArgs = mockQuery.mock.calls[0][0] as {
        prompt: string;
        options: Record<string, unknown>;
      };

      expect(callArgs.options).toEqual(
        expect.objectContaining({
          model: 'opus',
          maxTurns: 10,
          permissionMode: 'bypassPermissions',
          allowedTools: ['Read', 'Write'],
          disallowedTools: ['Bash'],
          systemPrompt: 'You are a helpful agent.',
          cwd: '/tmp/test-project',
        }),
      );
    });

    it('uses default config values when AgentConfig is empty', async () => {
      const messages: Record<string, unknown>[] = [
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      await runWithSdk(makeOptions({ config: {} }));

      const callArgs = mockQuery.mock.calls[0][0] as {
        prompt: string;
        options: Record<string, unknown>;
      };

      expect(callArgs.options).toEqual(
        expect.objectContaining({
          model: 'sonnet',
          maxTurns: 50,
          permissionMode: 'acceptEdits',
          cwd: '/tmp/test-project',
        }),
      );

      // Optional fields should not be present when not provided
      expect(callArgs.options).not.toHaveProperty('allowedTools');
      expect(callArgs.options).not.toHaveProperty('disallowedTools');
      expect(callArgs.options).not.toHaveProperty('systemPrompt');
    });
  });

  describe('dynamic import fallback', () => {
    it('returns null when SDK module exports no query function', async () => {
      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        // Module exists but has no query function
        someOtherExport: 'hello',
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const result = await runWithSdk(makeOptions());

      expect(result).toBeNull();
    });

    it('returns null when SDK default export has no query function', async () => {
      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        default: { notQuery: true },
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const result = await runWithSdk(makeOptions());

      expect(result).toBeNull();
    });

    it('returns null when default export contains a non-function query property', async () => {
      // Exercise the fallback path: mod.query is undefined, mod.default.query
      // exists but is not a function, so loadSdk should return null.
      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        default: { query: 'not-a-function' },
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const result = await runWithSdk(makeOptions());

      expect(result).toBeNull();
    });

    it('uses top-level query export when both top-level and default exist', async () => {
      const messages: Record<string, unknown>[] = [
        { type: 'result', result: 'From top-level', session_id: 'session-top' },
      ];

      const topLevelQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));
      const defaultQuery = vi.fn();

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: topLevelQuery,
        default: { query: defaultQuery },
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const result = await runWithSdk(makeOptions());

      expect(result).not.toBeNull();
      expect(result?.result).toBe('From top-level');
      // Top-level query should be preferred over default.query
      expect(topLevelQuery).toHaveBeenCalledTimes(1);
      expect(defaultQuery).not.toHaveBeenCalled();
    });
  });

  describe('handleSdkMessage (via runWithSdk event emission)', () => {
    it('emits cost events when usage information is present', async () => {
      const messages: Record<string, unknown>[] = [
        {
          type: 'assistant',
          content: 'Thinking...',
          usage: { input_tokens: 100, output_tokens: 50 },
          turn_cost_usd: 0.001,
          total_cost_usd: 0.001,
        },
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const { onEvent, outputStream } = makeOutputStream();
      await runWithSdk(makeOptions({ outputStream }));

      const costEvents = onEvent.mock.calls
        .map((call: unknown[]) => call[0] as AgentEvent)
        .filter((e: AgentEvent) => e.event === 'cost');

      expect(costEvents.length).toBeGreaterThanOrEqual(1);
      expect(costEvents[0].data).toEqual(
        expect.objectContaining({
          turnCost: 0.001,
          totalCost: 0.001,
        }),
      );
    });

    it('handles messages with missing optional fields gracefully', async () => {
      const messages: Record<string, unknown>[] = [
        // assistant with no content
        { type: 'assistant' },
        // tool_use with no tool_name
        { type: 'tool_use' },
        // tool_result with no content
        { type: 'tool_result' },
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const { outputStream } = makeOutputStream();
      const preToolUse = vi.fn().mockResolvedValue('allow');

      // Should not throw even with missing fields
      const result = await runWithSdk(makeOptions({ outputStream, hooks: { preToolUse } }));

      expect(result).not.toBeNull();
    });

    it('does not emit cost event when no usage information is present', async () => {
      const messages: Record<string, unknown>[] = [
        { type: 'assistant', content: 'No usage data here' },
        { type: 'result', result: 'Done', session_id: 'session-1' },
      ];

      const mockQuery = vi.fn().mockReturnValue(asyncIterableFrom(messages));

      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: mockQuery,
      }));

      const { runWithSdk } = await import('./sdk-runner.js');

      const { onEvent, outputStream } = makeOutputStream();
      await runWithSdk(makeOptions({ outputStream }));

      const costEvents = onEvent.mock.calls
        .map((call: unknown[]) => call[0] as AgentEvent)
        .filter((e: AgentEvent) => e.event === 'cost');

      expect(costEvents.length).toBe(0);
    });
  });
});
