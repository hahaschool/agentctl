import { describe, expect, it } from 'vitest';

import type {
  AgentApprovalEvent,
  AgentCostEvent,
  AgentEvent,
  AgentOutputEvent,
  AgentRawOutputEvent,
  AgentSafetyEvent,
  ContentMessage,
  ContentMessageType,
  LoopCompleteEvent,
  LoopIterationEvent,
} from './events.js';

// ---------------------------------------------------------------------------
// AgentEvent union — verify each variant is assignable
// ---------------------------------------------------------------------------

describe('AgentEvent union', () => {
  it('accepts an output event', () => {
    const event: AgentEvent = {
      event: 'output',
      data: { type: 'text', content: 'Hello world' },
    };
    expect(event.event).toBe('output');
  });

  it('accepts a raw_output event', () => {
    const event: AgentEvent = {
      event: 'raw_output',
      data: { text: 'raw terminal bytes\r\n' },
    };
    expect(event.event).toBe('raw_output');
  });

  it('accepts a status event', () => {
    const event: AgentEvent = {
      event: 'status',
      data: { status: 'running' },
    };
    expect(event.event).toBe('status');
  });

  it('accepts a status event with reason', () => {
    const event: AgentEvent = {
      event: 'status',
      data: { status: 'error', reason: 'out of memory' },
    };
    expect(event.event).toBe('status');
    if (event.event === 'status') {
      expect(event.data.reason).toBe('out of memory');
    }
  });

  it('accepts a cost event', () => {
    const event: AgentEvent = {
      event: 'cost',
      data: { turnCost: 0.05, totalCost: 1.25 },
    };
    expect(event.event).toBe('cost');
  });

  it('accepts an approval_needed event', () => {
    const event: AgentEvent = {
      event: 'approval_needed',
      data: { tool: 'Bash', input: { command: 'rm -rf /' }, timeoutSeconds: 30 },
    };
    expect(event.event).toBe('approval_needed');
  });

  it('accepts a heartbeat event', () => {
    const event: AgentEvent = {
      event: 'heartbeat',
      data: { timestamp: Date.now() },
    };
    expect(event.event).toBe('heartbeat');
  });

  it('accepts a loop_iteration event', () => {
    const event: AgentEvent = {
      event: 'loop_iteration',
      data: { iteration: 3, costUsd: 0.15, durationMs: 5000 },
    };
    expect(event.event).toBe('loop_iteration');
  });

  it('accepts a loop_complete event', () => {
    const event: AgentEvent = {
      event: 'loop_complete',
      data: { totalIterations: 10, totalCostUsd: 1.5, reason: 'max iterations' },
    };
    expect(event.event).toBe('loop_complete');
  });

  it('accepts a user_message event', () => {
    const event: AgentEvent = {
      event: 'user_message',
      data: { text: 'Please also update the README' },
    };
    expect(event.event).toBe('user_message');
  });

  it('accepts a safety_approval_needed event', () => {
    const event: AgentEvent = {
      event: 'safety_approval_needed',
      data: {
        tier: 'risky',
        warning: 'Project path is not a git repository.',
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'sandbox', label: 'Sandbox' },
          { id: 'reject', label: 'Reject' },
        ],
      },
    };
    expect(event.event).toBe('safety_approval_needed');
  });
});

// ---------------------------------------------------------------------------
// Individual event type shapes
// ---------------------------------------------------------------------------

describe('AgentOutputEvent', () => {
  it('accepts all valid output types', () => {
    const types: AgentOutputEvent['data']['type'][] = [
      'text',
      'tool_use',
      'tool_result',
      'tool_blocked',
    ];

    for (const type of types) {
      const event: AgentOutputEvent = {
        event: 'output',
        data: { type, content: `content for ${type}` },
      };
      expect(event.data.type).toBe(type);
    }
  });
});

describe('AgentRawOutputEvent', () => {
  it('has the expected shape', () => {
    const event: AgentRawOutputEvent = {
      event: 'raw_output',
      data: { text: '\x1b[32m✓\x1b[0m test passed' },
    };
    expect(event.event).toBe('raw_output');
    expect(event.data.text).toContain('test passed');
  });
});

describe('AgentCostEvent', () => {
  it('carries turnCost and totalCost', () => {
    const event: AgentCostEvent = {
      event: 'cost',
      data: { turnCost: 0.03, totalCost: 0.75 },
    };
    expect(event.data.turnCost).toBe(0.03);
    expect(event.data.totalCost).toBe(0.75);
  });

  it('handles zero costs', () => {
    const event: AgentCostEvent = {
      event: 'cost',
      data: { turnCost: 0, totalCost: 0 },
    };
    expect(event.data.turnCost).toBe(0);
    expect(event.data.totalCost).toBe(0);
  });
});

describe('AgentApprovalEvent', () => {
  it('carries tool name, input, and timeout', () => {
    const event: AgentApprovalEvent = {
      event: 'approval_needed',
      data: { tool: 'Write', input: { path: '/etc/hosts' }, timeoutSeconds: 60 },
    };
    expect(event.data.tool).toBe('Write');
    expect(event.data.timeoutSeconds).toBe(60);
  });
});

describe('AgentSafetyEvent', () => {
  it('carries tier-specific safety metadata', () => {
    const event: AgentSafetyEvent = {
      event: 'safety_warning',
      data: {
        tier: 'guarded',
        warning: 'Working directory has uncommitted changes.',
        parallelTaskCount: 1,
      },
    };

    expect(event.event).toBe('safety_warning');
    expect(event.data.tier).toBe('guarded');
    expect(event.data.warning).toContain('uncommitted changes');
  });
});

describe('LoopIterationEvent', () => {
  it('carries iteration number, cost, and duration', () => {
    const event: LoopIterationEvent = {
      event: 'loop_iteration',
      data: { iteration: 7, costUsd: 0.42, durationMs: 12000 },
    };
    expect(event.data.iteration).toBe(7);
    expect(event.data.costUsd).toBe(0.42);
    expect(event.data.durationMs).toBe(12000);
  });
});

describe('LoopCompleteEvent', () => {
  it('carries completion summary', () => {
    const event: LoopCompleteEvent = {
      event: 'loop_complete',
      data: { totalIterations: 50, totalCostUsd: 5.0, reason: 'cost limit' },
    };
    expect(event.data.totalIterations).toBe(50);
    expect(event.data.totalCostUsd).toBe(5.0);
    expect(event.data.reason).toBe('cost limit');
  });
});

// ---------------------------------------------------------------------------
// ContentMessage — the shared session content type
// ---------------------------------------------------------------------------

describe('ContentMessage', () => {
  it('accepts a minimal message with only required fields', () => {
    const msg: ContentMessage = {
      type: 'assistant',
      content: 'Hello, I can help with that.',
    };
    expect(msg.type).toBe('assistant');
    expect(msg.content).toBe('Hello, I can help with that.');
    expect(msg.timestamp).toBeUndefined();
    expect(msg.toolName).toBeUndefined();
    expect(msg.toolId).toBeUndefined();
    expect(msg.subagentId).toBeUndefined();
    expect(msg.metadata).toBeUndefined();
  });

  it('accepts a fully populated message', () => {
    const msg: ContentMessage = {
      type: 'tool_use',
      content: 'Running bash command...',
      timestamp: '2026-03-07T10:00:00.000Z',
      toolName: 'Bash',
      toolId: 'toolu_abc123',
      subagentId: 'sub-agent-42',
      metadata: { exitCode: 0, durationMs: 1500 },
    };
    expect(msg.type).toBe('tool_use');
    expect(msg.content).toBe('Running bash command...');
    expect(msg.timestamp).toBe('2026-03-07T10:00:00.000Z');
    expect(msg.toolName).toBe('Bash');
    expect(msg.toolId).toBe('toolu_abc123');
    expect(msg.subagentId).toBe('sub-agent-42');
    expect(msg.metadata).toEqual({ exitCode: 0, durationMs: 1500 });
  });

  it('accepts all known ContentMessageType values', () => {
    const types: ContentMessageType[] = [
      'human',
      'assistant',
      'thinking',
      'tool_use',
      'tool_result',
      'progress',
      'subagent',
      'todo',
    ];

    for (const type of types) {
      const msg: ContentMessage = { type, content: `content for ${type}` };
      expect(msg.type).toBe(type);
    }
    expect(types).toHaveLength(8);
  });

  it('allows arbitrary string types via intersection (for forward compatibility)', () => {
    // ContentMessageType includes (string & {}) so custom types are accepted
    const msg: ContentMessage = {
      type: 'custom_future_type',
      content: 'some content',
    };
    expect(msg.type).toBe('custom_future_type');
  });

  it('serializes and deserializes correctly as JSON', () => {
    const original: ContentMessage = {
      type: 'tool_result',
      content: 'File written successfully',
      timestamp: '2026-03-07T10:00:00.000Z',
      toolName: 'Write',
      toolId: 'toolu_xyz789',
      metadata: { bytesWritten: 1024 },
    };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as ContentMessage;
    expect(parsed).toEqual(original);
  });

  it('handles empty content string', () => {
    const msg: ContentMessage = { type: 'progress', content: '' };
    expect(msg.content).toBe('');
  });

  it('pairs tool_use and tool_result via toolId', () => {
    const toolUse: ContentMessage = {
      type: 'tool_use',
      content: 'Reading file...',
      toolName: 'Read',
      toolId: 'toolu_read_001',
    };

    const toolResult: ContentMessage = {
      type: 'tool_result',
      content: 'const x = 42;',
      toolName: 'Read',
      toolId: 'toolu_read_001',
    };

    expect(toolUse.toolId).toBe(toolResult.toolId);
  });

  it('tags subagent messages with subagentId', () => {
    const msg: ContentMessage = {
      type: 'subagent',
      content: 'Sub-agent completed analysis',
      toolName: 'code-reviewer',
      subagentId: 'a4de052fcb9393841',
    };

    expect(msg.subagentId).toBe('a4de052fcb9393841');
  });

  it('supports progress message types with toolName', () => {
    const bashProgress: ContentMessage = {
      type: 'progress',
      content: 'npm install',
      toolName: 'bash',
    };
    expect(bashProgress.toolName).toBe('bash');

    const mcpProgress: ContentMessage = {
      type: 'progress',
      content: 'filesystem: list_directory',
      toolName: 'mcp',
    };
    expect(mcpProgress.toolName).toBe('mcp');

    const hookProgress: ContentMessage = {
      type: 'progress',
      content: 'pre-commit (PreToolUse)',
      toolName: 'hook',
    };
    expect(hookProgress.toolName).toBe('hook');
  });

  it('handles thinking blocks', () => {
    const msg: ContentMessage = {
      type: 'thinking',
      content: 'Let me analyze the codebase structure...',
      timestamp: '2026-03-07T10:00:00.000Z',
    };
    expect(msg.type).toBe('thinking');
    expect(msg.content).toContain('analyze');
  });

  it('handles todo blocks', () => {
    const msg: ContentMessage = {
      type: 'todo',
      content: '- [x] Fix login bug\n- [ ] Update tests',
    };
    expect(msg.type).toBe('todo');
  });
});
