import type { AgentEvent } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { EventedAgentOutputStream } from './agent-output-stream.js';

describe('EventedAgentOutputStream', () => {
  it('maps text, tool, and cost calls onto the current AgentEvent shape', () => {
    const events: AgentEvent[] = [];
    const stream = new EventedAgentOutputStream((event) => events.push(event));

    stream.text('hello');
    stream.toolUse('Write', { filePath: '/tmp/hello.ts' });
    stream.toolResult('Write', 'done');
    stream.toolBlocked('Bash', 'blocked by policy');
    stream.costUpdate(0.01, 0.03);

    expect(events).toEqual([
      {
        event: 'output',
        data: {
          type: 'text',
          content: 'hello',
        },
      },
      {
        event: 'output',
        data: {
          type: 'tool_use',
          content: JSON.stringify({
            tool: 'Write',
            input: { filePath: '/tmp/hello.ts' },
          }),
        },
      },
      {
        event: 'output',
        data: {
          type: 'tool_result',
          content: 'done',
        },
      },
      {
        event: 'output',
        data: {
          type: 'tool_blocked',
          content: "Tool 'Bash' was blocked: blocked by policy",
        },
      },
      {
        event: 'cost',
        data: {
          turnCost: 0.01,
          totalCost: 0.03,
        },
      },
    ]);
  });

  it('stringifies non-string tool results', () => {
    const events: AgentEvent[] = [];
    const stream = new EventedAgentOutputStream((event) => events.push(event));

    stream.toolResult('Read', { lines: 10, ok: true });

    expect(events).toEqual([
      {
        event: 'output',
        data: {
          type: 'tool_result',
          content: JSON.stringify({ lines: 10, ok: true }),
        },
      },
    ]);
  });
});
