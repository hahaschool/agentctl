import { describe, expect, it } from 'vitest';

import type {
  HeartbeatRequest,
  RegisterWorkerRequest,
  SendMessageRequest,
  SignalAgentRequest,
  StartAgentRequest,
  StopAgentRequest,
} from './commands.js';

// ── StartAgentRequest ───────────────────────────────────────────────

describe('StartAgentRequest', () => {
  it('accepts a fully populated request', () => {
    const req: StartAgentRequest = {
      prompt: 'Fix the login bug',
      resumeSession: 'session-abc-123',
      model: 'claude-sonnet-4-20250514',
      allowedTools: ['Read', 'Write', 'Bash'],
    };

    expect(req.prompt).toBe('Fix the login bug');
    expect(req.resumeSession).toBe('session-abc-123');
    expect(req.model).toBe('claude-sonnet-4-20250514');
    expect(req.allowedTools).toEqual(['Read', 'Write', 'Bash']);
  });

  it('accepts an empty request (all fields are optional)', () => {
    const req: StartAgentRequest = {};

    expect(req.prompt).toBeUndefined();
    expect(req.resumeSession).toBeUndefined();
    expect(req.model).toBeUndefined();
    expect(req.allowedTools).toBeUndefined();
  });

  it('accepts a request with only a prompt', () => {
    const req: StartAgentRequest = { prompt: 'Run the tests' };

    expect(req.prompt).toBe('Run the tests');
    expect(req.model).toBeUndefined();
  });

  it('accepts an empty allowedTools array', () => {
    const req: StartAgentRequest = { allowedTools: [] };

    expect(req.allowedTools).toEqual([]);
  });

  it('serializes and deserializes correctly as JSON', () => {
    const original: StartAgentRequest = {
      prompt: 'Deploy to staging',
      model: 'claude-opus-4-20250514',
      allowedTools: ['Bash'],
    };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as StartAgentRequest;

    expect(parsed).toEqual(original);
  });
});

// ── StopAgentRequest ────────────────────────────────────────────────

describe('StopAgentRequest', () => {
  it('has the correct shape with reason and graceful', () => {
    const req: StopAgentRequest = {
      reason: 'user',
      graceful: true,
    };

    expect(req.reason).toBe('user');
    expect(req.graceful).toBe(true);
  });

  it('accepts all valid reason values', () => {
    const reasons = ['user', 'timeout', 'error', 'schedule'] as const;

    for (const reason of reasons) {
      const req: StopAgentRequest = { reason, graceful: false };
      expect(req.reason).toBe(reason);
    }
  });

  it('has exactly 4 valid reason values', () => {
    const reasons = new Set(['user', 'timeout', 'error', 'schedule']);
    expect(reasons.size).toBe(4);
  });

  it('graceful can be true or false', () => {
    const gracefulReq: StopAgentRequest = { reason: 'user', graceful: true };
    const forceReq: StopAgentRequest = { reason: 'error', graceful: false };

    expect(gracefulReq.graceful).toBe(true);
    expect(forceReq.graceful).toBe(false);
  });

  it('serializes and deserializes correctly as JSON', () => {
    const original: StopAgentRequest = { reason: 'timeout', graceful: true };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as StopAgentRequest;

    expect(parsed).toEqual(original);
  });
});

// ── SendMessageRequest ──────────────────────────────────────────────

describe('SendMessageRequest', () => {
  it('has the correct shape with content', () => {
    const req: SendMessageRequest = {
      content: 'Please also update the README',
    };

    expect(req.content).toBe('Please also update the README');
    expect(req.approval).toBeUndefined();
  });

  it('accepts an optional approval field', () => {
    const approved: SendMessageRequest = {
      content: 'Yes, go ahead',
      approval: true,
    };

    expect(approved.approval).toBe(true);

    const rejected: SendMessageRequest = {
      content: 'No, abort',
      approval: false,
    };

    expect(rejected.approval).toBe(false);
  });

  it('handles empty content string', () => {
    const req: SendMessageRequest = { content: '' };

    expect(req.content).toBe('');
  });

  it('handles unicode content', () => {
    const req: SendMessageRequest = {
      content: 'Deploy to production with Japanese: \u672C\u756A\u74B0\u5883',
    };

    expect(req.content).toContain('\u672C\u756A\u74B0\u5883');
  });
});

// ── RegisterWorkerRequest ───────────────────────────────────────────

describe('RegisterWorkerRequest', () => {
  it('has the correct shape with all required fields', () => {
    const req: RegisterWorkerRequest = {
      machineId: 'mac-mini-01',
      hostname: 'mac-mini-01.tail1234.ts.net',
      tailscaleIp: '100.64.0.1',
      os: 'darwin',
      arch: 'arm64',
      capabilities: {
        gpu: false,
        docker: true,
        maxConcurrentAgents: 4,
      },
    };

    expect(req.machineId).toBe('mac-mini-01');
    expect(req.hostname).toBe('mac-mini-01.tail1234.ts.net');
    expect(req.tailscaleIp).toBe('100.64.0.1');
    expect(req.os).toBe('darwin');
    expect(req.arch).toBe('arm64');
    expect(req.capabilities.gpu).toBe(false);
    expect(req.capabilities.docker).toBe(true);
    expect(req.capabilities.maxConcurrentAgents).toBe(4);
  });

  it('accepts linux/x64 configuration', () => {
    const req: RegisterWorkerRequest = {
      machineId: 'ec2-worker-01',
      hostname: 'ec2-worker-01.tail5678.ts.net',
      tailscaleIp: '100.64.0.2',
      os: 'linux',
      arch: 'x64',
      capabilities: {
        gpu: true,
        docker: true,
        maxConcurrentAgents: 8,
      },
    };

    expect(req.os).toBe('linux');
    expect(req.arch).toBe('x64');
    expect(req.capabilities.gpu).toBe(true);
  });

  it('accepts darwin/arm64 configuration', () => {
    const req: RegisterWorkerRequest = {
      machineId: 'macbook-pro',
      hostname: 'macbook.local',
      tailscaleIp: '100.64.0.3',
      os: 'darwin',
      arch: 'arm64',
      capabilities: {
        gpu: false,
        docker: false,
        maxConcurrentAgents: 2,
      },
    };

    expect(req.os).toBe('darwin');
    expect(req.arch).toBe('arm64');
  });

  it('capabilities has exactly three fields', () => {
    const capabilities: RegisterWorkerRequest['capabilities'] = {
      gpu: false,
      docker: true,
      maxConcurrentAgents: 1,
    };

    expect(Object.keys(capabilities)).toHaveLength(3);
    expect(Object.keys(capabilities).sort()).toEqual([
      'docker',
      'gpu',
      'maxConcurrentAgents',
    ]);
  });

  it('serializes and deserializes correctly as JSON', () => {
    const original: RegisterWorkerRequest = {
      machineId: 'test-machine',
      hostname: 'test.ts.net',
      tailscaleIp: '100.64.0.10',
      os: 'linux',
      arch: 'x64',
      capabilities: {
        gpu: true,
        docker: true,
        maxConcurrentAgents: 16,
      },
    };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as RegisterWorkerRequest;

    expect(parsed).toEqual(original);
  });
});

// ── HeartbeatRequest ────────────────────────────────────────────────

describe('HeartbeatRequest', () => {
  it('has the correct shape with all required fields', () => {
    const req: HeartbeatRequest = {
      machineId: 'mac-mini-01',
      runningAgents: [
        { agentId: 'agent-1', sessionId: 'sess-abc' },
        { agentId: 'agent-2', sessionId: null },
      ],
      cpuPercent: 45.2,
      memoryPercent: 72.8,
    };

    expect(req.machineId).toBe('mac-mini-01');
    expect(req.runningAgents).toHaveLength(2);
    expect(req.cpuPercent).toBe(45.2);
    expect(req.memoryPercent).toBe(72.8);
  });

  it('accepts an empty runningAgents array', () => {
    const req: HeartbeatRequest = {
      machineId: 'idle-machine',
      runningAgents: [],
      cpuPercent: 5.0,
      memoryPercent: 20.0,
    };

    expect(req.runningAgents).toEqual([]);
  });

  it('runningAgents entries have agentId and nullable sessionId', () => {
    const req: HeartbeatRequest = {
      machineId: 'worker-01',
      runningAgents: [
        { agentId: 'a1', sessionId: 'sess-1' },
        { agentId: 'a2', sessionId: null },
      ],
      cpuPercent: 50,
      memoryPercent: 60,
    };

    expect(req.runningAgents[0].sessionId).toBe('sess-1');
    expect(req.runningAgents[1].sessionId).toBeNull();
  });

  it('handles boundary cpu/memory values', () => {
    const zeroLoad: HeartbeatRequest = {
      machineId: 'm1',
      runningAgents: [],
      cpuPercent: 0,
      memoryPercent: 0,
    };
    expect(zeroLoad.cpuPercent).toBe(0);
    expect(zeroLoad.memoryPercent).toBe(0);

    const maxLoad: HeartbeatRequest = {
      machineId: 'm2',
      runningAgents: [],
      cpuPercent: 100,
      memoryPercent: 100,
    };
    expect(maxLoad.cpuPercent).toBe(100);
    expect(maxLoad.memoryPercent).toBe(100);
  });

  it('serializes and deserializes correctly as JSON', () => {
    const original: HeartbeatRequest = {
      machineId: 'test',
      runningAgents: [{ agentId: 'a1', sessionId: null }],
      cpuPercent: 33.3,
      memoryPercent: 55.5,
    };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as HeartbeatRequest;

    expect(parsed).toEqual(original);
  });
});

// ── SignalAgentRequest ──────────────────────────────────────────────

describe('SignalAgentRequest', () => {
  it('has the correct shape with prompt', () => {
    const req: SignalAgentRequest = {
      prompt: 'Check if there are any failing tests',
    };

    expect(req.prompt).toBe('Check if there are any failing tests');
    expect(req.metadata).toBeUndefined();
  });

  it('accepts optional metadata', () => {
    const req: SignalAgentRequest = {
      prompt: 'Run deployment',
      metadata: {
        environment: 'staging',
        triggeredBy: 'cron',
        priority: 1,
      },
    };

    expect(req.metadata).toEqual({
      environment: 'staging',
      triggeredBy: 'cron',
      priority: 1,
    });
  });

  it('metadata accepts unknown value types', () => {
    const req: SignalAgentRequest = {
      prompt: 'test',
      metadata: {
        stringVal: 'hello',
        numberVal: 42,
        boolVal: true,
        nullVal: null,
        nestedObj: { a: 1 },
        arrayVal: [1, 2, 3],
      },
    };

    expect(req.metadata?.stringVal).toBe('hello');
    expect(req.metadata?.numberVal).toBe(42);
    expect(req.metadata?.boolVal).toBe(true);
    expect(req.metadata?.nullVal).toBeNull();
    expect(req.metadata?.nestedObj).toEqual({ a: 1 });
    expect(req.metadata?.arrayVal).toEqual([1, 2, 3]);
  });

  it('serializes and deserializes correctly as JSON', () => {
    const original: SignalAgentRequest = {
      prompt: 'signal test',
      metadata: { key: 'value' },
    };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as SignalAgentRequest;

    expect(parsed).toEqual(original);
  });
});
