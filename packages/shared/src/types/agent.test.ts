import { describe, expect, it } from 'vitest';

import type { Agent, AgentConfig, AgentType, PromptTemplateVars, ScheduleConfig, SessionMode } from './agent.js';
import { AGENT_STATUSES } from './agent.js';
import type { AgentRun, RunStatus, RunTrigger } from './agent-run.js';
import { AgentError, ControlPlaneError, WorkerError } from './errors.js';
import type { Machine, MachineCapabilities, MachineStatus } from './machine.js';

// ── AGENT_STATUSES constant ─────────────────────────────────────────

describe('AGENT_STATUSES', () => {
  it('is a readonly array (as const makes it readonly at the type level)', () => {
    expect(Array.isArray(AGENT_STATUSES)).toBe(true);
    // `as const` is a compile-time assertion only. At runtime the array
    // is a normal JS array. We verify it exists and is an array.
    expect(AGENT_STATUSES.length).toBeGreaterThan(0);
  });

  it('contains exactly 8 statuses', () => {
    expect(AGENT_STATUSES).toHaveLength(8);
  });

  it('contains all expected status values', () => {
    const expected = [
      'registered',
      'starting',
      'running',
      'stopping',
      'stopped',
      'error',
      'timeout',
      'restarting',
    ];

    expect([...AGENT_STATUSES]).toEqual(expected);
  });

  it('has no duplicate values', () => {
    const unique = new Set(AGENT_STATUSES);
    expect(unique.size).toBe(AGENT_STATUSES.length);
  });

  it('every element is a non-empty string', () => {
    for (const status of AGENT_STATUSES) {
      expect(typeof status).toBe('string');
      expect(status.length).toBeGreaterThan(0);
    }
  });
});

// ── AgentType union ─────────────────────────────────────────────────

describe('AgentType', () => {
  it('covers all five agent types', () => {
    const types: AgentType[] = ['heartbeat', 'cron', 'manual', 'adhoc', 'loop'];
    expect(types).toHaveLength(5);
  });

  it('each type is a distinct string', () => {
    const types: AgentType[] = ['heartbeat', 'cron', 'manual', 'adhoc', 'loop'];
    const unique = new Set(types);
    expect(unique.size).toBe(5);
  });
});

// ── AgentConfig shape ───────────────────────────────────────────────

describe('AgentConfig', () => {
  it('accepts a fully populated config', () => {
    const config: AgentConfig = {
      allowedTools: ['Read', 'Write', 'Edit'],
      disallowedTools: ['Bash'],
      model: 'claude-sonnet-4-20250514',
      maxTurns: 25,
      permissionMode: 'acceptEdits',
      systemPrompt: 'You are a helpful coding assistant.',
    };

    expect(config.allowedTools).toEqual(['Read', 'Write', 'Edit']);
    expect(config.disallowedTools).toEqual(['Bash']);
    expect(config.model).toBe('claude-sonnet-4-20250514');
    expect(config.maxTurns).toBe(25);
    expect(config.permissionMode).toBe('acceptEdits');
    expect(config.systemPrompt).toBe('You are a helpful coding assistant.');
  });

  it('accepts an empty config (all fields are optional)', () => {
    const config: AgentConfig = {};

    expect(config.allowedTools).toBeUndefined();
    expect(config.disallowedTools).toBeUndefined();
    expect(config.model).toBeUndefined();
    expect(config.maxTurns).toBeUndefined();
    expect(config.permissionMode).toBeUndefined();
    expect(config.systemPrompt).toBeUndefined();
  });

  it('accepts all valid permissionMode values', () => {
    const modes: AgentConfig['permissionMode'][] = [
      'default',
      'acceptEdits',
      'plan',
      'bypassPermissions',
    ];

    for (const mode of modes) {
      const config: AgentConfig = { permissionMode: mode };
      expect(config.permissionMode).toBe(mode);
    }
  });

  it('has exactly 4 valid permissionMode values', () => {
    const modes = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
    expect(modes.size).toBe(4);
  });

  it('accepts empty tool arrays', () => {
    const config: AgentConfig = {
      allowedTools: [],
      disallowedTools: [],
    };

    expect(config.allowedTools).toEqual([]);
    expect(config.disallowedTools).toEqual([]);
  });
});

// ── Agent shape ─────────────────────────────────────────────────────

describe('Agent', () => {
  it('has the correct shape with all required fields', () => {
    const now = new Date();
    const agent: Agent = {
      id: 'agent-001',
      machineId: 'mac-mini-01',
      name: 'Code Reviewer',
      type: 'manual',
      status: 'registered',
      schedule: null,
      projectPath: '/home/user/projects/agentctl',
      worktreeBranch: 'agent-001/feature/review',
      currentSessionId: null,
      config: { model: 'claude-sonnet-4-20250514' },
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: now,
    };

    expect(agent.id).toBe('agent-001');
    expect(agent.machineId).toBe('mac-mini-01');
    expect(agent.name).toBe('Code Reviewer');
    expect(agent.type).toBe('manual');
    expect(agent.status).toBe('registered');
    expect(agent.schedule).toBeNull();
    expect(agent.projectPath).toBe('/home/user/projects/agentctl');
    expect(agent.worktreeBranch).toBe('agent-001/feature/review');
    expect(agent.currentSessionId).toBeNull();
    expect(agent.config.model).toBe('claude-sonnet-4-20250514');
    expect(agent.lastRunAt).toBeNull();
    expect(agent.lastCostUsd).toBeNull();
    expect(agent.totalCostUsd).toBe(0);
    expect(agent.createdAt).toBe(now);
  });

  it('accepts a cron-type agent with a schedule', () => {
    const agent: Agent = {
      id: 'agent-cron-01',
      machineId: 'ec2-01',
      name: 'Daily Test Runner',
      type: 'cron',
      status: 'stopped',
      schedule: '0 6 * * *',
      projectPath: '/opt/projects/main',
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: new Date('2026-03-01T06:00:00Z'),
      lastCostUsd: 0.15,
      totalCostUsd: 3.5,
      createdAt: new Date('2026-01-15T10:00:00Z'),
    };

    expect(agent.type).toBe('cron');
    expect(agent.schedule).toBe('0 6 * * *');
    expect(agent.lastRunAt).toBeInstanceOf(Date);
    expect(agent.lastCostUsd).toBe(0.15);
    expect(agent.totalCostUsd).toBe(3.5);
  });

  it('nullable fields accept both null and non-null values', () => {
    const agentWithNulls: Agent = {
      id: 'a1',
      machineId: 'm1',
      name: 'Test',
      type: 'adhoc',
      status: 'registered',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    };

    expect(agentWithNulls.schedule).toBeNull();
    expect(agentWithNulls.projectPath).toBeNull();
    expect(agentWithNulls.worktreeBranch).toBeNull();
    expect(agentWithNulls.currentSessionId).toBeNull();
    expect(agentWithNulls.lastRunAt).toBeNull();
    expect(agentWithNulls.lastCostUsd).toBeNull();

    const agentWithValues: Agent = {
      id: 'a2',
      machineId: 'm2',
      name: 'Test',
      type: 'heartbeat',
      status: 'running',
      schedule: '*/5 * * * *',
      projectPath: '/opt/proj',
      worktreeBranch: 'main',
      currentSessionId: 'sess-123',
      config: {},
      lastRunAt: new Date(),
      lastCostUsd: 0.05,
      totalCostUsd: 1.0,
      createdAt: new Date(),
    };

    expect(agentWithValues.schedule).toBe('*/5 * * * *');
    expect(agentWithValues.projectPath).toBe('/opt/proj');
    expect(agentWithValues.worktreeBranch).toBe('main');
    expect(agentWithValues.currentSessionId).toBe('sess-123');
    expect(agentWithValues.lastRunAt).toBeInstanceOf(Date);
    expect(agentWithValues.lastCostUsd).toBe(0.05);
  });

  it('status accepts every value from AGENT_STATUSES', () => {
    for (const status of AGENT_STATUSES) {
      const agent: Agent = {
        id: 'a',
        machineId: 'm',
        name: 'Test',
        type: 'manual',
        status,
        schedule: null,
        projectPath: null,
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: 0,
        createdAt: new Date(),
      };
      expect(AGENT_STATUSES).toContain(agent.status);
    }
  });
});

// ── AgentRun shape ──────────────────────────────────────────────────

describe('AgentRun', () => {
  it('has the correct shape with all required fields', () => {
    const run: AgentRun = {
      id: 'run-001',
      agentId: 'agent-001',
      trigger: 'manual',
      status: 'running',
      startedAt: new Date('2026-03-02T10:00:00Z'),
      finishedAt: null,
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      sessionId: 'sess-abc',
      errorMessage: null,
      resultSummary: null,
    };

    expect(run.id).toBe('run-001');
    expect(run.agentId).toBe('agent-001');
    expect(run.trigger).toBe('manual');
    expect(run.status).toBe('running');
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeNull();
    expect(run.model).toBe('claude-sonnet-4-20250514');
    expect(run.provider).toBe('anthropic');
    expect(run.sessionId).toBe('sess-abc');
  });

  it('accepts a completed run with all fields populated', () => {
    const run: AgentRun = {
      id: 'run-002',
      agentId: 'agent-001',
      trigger: 'schedule',
      status: 'success',
      startedAt: new Date('2026-03-02T10:00:00Z'),
      finishedAt: new Date('2026-03-02T10:05:00Z'),
      costUsd: 0.25,
      tokensIn: 50000,
      tokensOut: 8000,
      model: 'claude-sonnet-4-20250514',
      provider: 'bedrock',
      sessionId: 'sess-def',
      errorMessage: null,
      resultSummary: 'All tests passed',
    };

    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.costUsd).toBe(0.25);
    expect(run.tokensIn).toBe(50000);
    expect(run.tokensOut).toBe(8000);
    expect(run.resultSummary).toBe('All tests passed');
  });

  it('accepts a failed run with error message', () => {
    const run: AgentRun = {
      id: 'run-003',
      agentId: 'agent-001',
      trigger: 'adhoc',
      status: 'failure',
      startedAt: new Date(),
      finishedAt: new Date(),
      costUsd: 0.02,
      tokensIn: 1000,
      tokensOut: 200,
      model: null,
      provider: null,
      sessionId: null,
      errorMessage: 'Agent crashed: out of memory',
      resultSummary: null,
    };

    expect(run.status).toBe('failure');
    expect(run.errorMessage).toBe('Agent crashed: out of memory');
    expect(run.model).toBeNull();
    expect(run.provider).toBeNull();
  });
});

describe('RunTrigger', () => {
  it('covers all five trigger types', () => {
    const triggers: RunTrigger[] = ['schedule', 'manual', 'signal', 'adhoc', 'heartbeat'];
    expect(triggers).toHaveLength(5);

    const unique = new Set(triggers);
    expect(unique.size).toBe(5);
  });
});

describe('RunStatus', () => {
  it('covers all five status types', () => {
    const statuses: RunStatus[] = ['running', 'success', 'failure', 'timeout', 'cancelled'];
    expect(statuses).toHaveLength(5);

    const unique = new Set(statuses);
    expect(unique.size).toBe(5);
  });
});

// ── Machine types ───────────────────────────────────────────────────

describe('Machine', () => {
  it('has the correct shape with all required fields', () => {
    const machine: Machine = {
      id: 'mac-mini-01',
      hostname: 'mac-mini-01.tail1234.ts.net',
      tailscaleIp: '100.64.0.1',
      os: 'darwin',
      arch: 'arm64',
      status: 'online',
      lastHeartbeat: new Date(),
      capabilities: {
        gpu: false,
        docker: true,
        maxConcurrentAgents: 4,
      },
      createdAt: new Date(),
    };

    expect(machine.id).toBe('mac-mini-01');
    expect(machine.os).toBe('darwin');
    expect(machine.arch).toBe('arm64');
    expect(machine.status).toBe('online');
    expect(machine.capabilities.maxConcurrentAgents).toBe(4);
  });

  it('accepts null lastHeartbeat for new machines', () => {
    const machine: Machine = {
      id: 'new-machine',
      hostname: 'new.ts.net',
      tailscaleIp: '100.64.0.99',
      os: 'linux',
      arch: 'x64',
      status: 'offline',
      lastHeartbeat: null,
      capabilities: { gpu: true, docker: true, maxConcurrentAgents: 16 },
      createdAt: new Date(),
    };

    expect(machine.lastHeartbeat).toBeNull();
  });
});

describe('MachineStatus', () => {
  it('covers all three status values', () => {
    const statuses: MachineStatus[] = ['online', 'offline', 'degraded'];
    expect(statuses).toHaveLength(3);

    const unique = new Set(statuses);
    expect(unique.size).toBe(3);
  });
});

describe('MachineCapabilities', () => {
  it('has the correct shape', () => {
    const caps: MachineCapabilities = {
      gpu: true,
      docker: true,
      maxConcurrentAgents: 8,
    };

    expect(caps.gpu).toBe(true);
    expect(caps.docker).toBe(true);
    expect(caps.maxConcurrentAgents).toBe(8);
  });

  it('handles zero maxConcurrentAgents', () => {
    const caps: MachineCapabilities = {
      gpu: false,
      docker: false,
      maxConcurrentAgents: 0,
    };

    expect(caps.maxConcurrentAgents).toBe(0);
  });
});

// ── SessionMode type ────────────────────────────────────────────

describe('SessionMode', () => {
  it('covers both session modes', () => {
    const modes: SessionMode[] = ['fresh', 'resume'];
    expect(modes).toHaveLength(2);

    const unique = new Set(modes);
    expect(unique.size).toBe(2);
  });
});

// ── ScheduleConfig shape ────────────────────────────────────────

describe('ScheduleConfig', () => {
  it('has the correct shape with required fields', () => {
    const config: ScheduleConfig = {
      sessionMode: 'fresh',
      promptTemplate: 'Run tests for {{date}}',
      pattern: '0 6 * * *',
    };

    expect(config.sessionMode).toBe('fresh');
    expect(config.promptTemplate).toBe('Run tests for {{date}}');
    expect(config.pattern).toBe('0 6 * * *');
    expect(config.timezone).toBeUndefined();
  });

  it('accepts optional timezone', () => {
    const config: ScheduleConfig = {
      sessionMode: 'resume',
      promptTemplate: 'Continue work on {{agentId}}',
      pattern: '*/30 * * * *',
      timezone: 'America/New_York',
    };

    expect(config.timezone).toBe('America/New_York');
    expect(config.sessionMode).toBe('resume');
  });
});

// ── PromptTemplateVars shape ────────────────────────────────────

describe('PromptTemplateVars', () => {
  it('has the correct shape with required fields', () => {
    const vars: PromptTemplateVars = {
      date: '2026-03-02',
      iteration: 0,
      agentId: 'agent-001',
    };

    expect(vars.date).toBe('2026-03-02');
    expect(vars.iteration).toBe(0);
    expect(vars.agentId).toBe('agent-001');
    expect(vars.lastResult).toBeUndefined();
  });

  it('accepts optional lastResult', () => {
    const vars: PromptTemplateVars = {
      date: '2026-03-02',
      iteration: 5,
      lastResult: 'All tests passed',
      agentId: 'agent-002',
    };

    expect(vars.lastResult).toBe('All tests passed');
    expect(vars.iteration).toBe(5);
  });
});

// ── Error types ─────────────────────────────────────────────────────

describe('AgentError', () => {
  it('has the correct name and properties', () => {
    const error = new AgentError('AGENT_TIMEOUT', 'Agent did not respond within 60s', {
      agentId: 'a1',
      timeout: 60,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AgentError);
    expect(error.name).toBe('AgentError');
    expect(error.code).toBe('AGENT_TIMEOUT');
    expect(error.message).toBe('Agent did not respond within 60s');
    expect(error.context).toEqual({ agentId: 'a1', timeout: 60 });
  });

  it('works without context', () => {
    const error = new AgentError('UNKNOWN', 'Something went wrong');

    expect(error.code).toBe('UNKNOWN');
    expect(error.context).toBeUndefined();
  });

  it('has a proper stack trace', () => {
    const error = new AgentError('TEST', 'test error');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AgentError');
  });
});

describe('WorkerError', () => {
  it('has the correct name and properties', () => {
    const error = new WorkerError('WORKER_OVERLOADED', 'Too many agents', {
      machineId: 'm1',
      currentLoad: 8,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WorkerError);
    expect(error.name).toBe('WorkerError');
    expect(error.code).toBe('WORKER_OVERLOADED');
    expect(error.message).toBe('Too many agents');
    expect(error.context).toEqual({ machineId: 'm1', currentLoad: 8 });
  });

  it('works without context', () => {
    const error = new WorkerError('DISCONNECTED', 'Lost connection');

    expect(error.code).toBe('DISCONNECTED');
    expect(error.context).toBeUndefined();
  });
});

describe('ControlPlaneError', () => {
  it('has the correct name and properties', () => {
    const error = new ControlPlaneError('DB_CONNECTION_FAILED', 'Cannot connect to PostgreSQL', {
      host: 'localhost',
      port: 5432,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(error.name).toBe('ControlPlaneError');
    expect(error.code).toBe('DB_CONNECTION_FAILED');
    expect(error.message).toBe('Cannot connect to PostgreSQL');
    expect(error.context).toEqual({ host: 'localhost', port: 5432 });
  });

  it('works without context', () => {
    const error = new ControlPlaneError('SCHEDULER_FAILED', 'BullMQ unavailable');

    expect(error.code).toBe('SCHEDULER_FAILED');
    expect(error.context).toBeUndefined();
  });
});

describe('Error type differentiation', () => {
  it('instanceof checks distinguish between error types', () => {
    const agentErr = new AgentError('A', 'agent');
    const workerErr = new WorkerError('W', 'worker');
    const cpErr = new ControlPlaneError('C', 'control plane');

    expect(agentErr).toBeInstanceOf(AgentError);
    expect(agentErr).not.toBeInstanceOf(WorkerError);
    expect(agentErr).not.toBeInstanceOf(ControlPlaneError);

    expect(workerErr).toBeInstanceOf(WorkerError);
    expect(workerErr).not.toBeInstanceOf(AgentError);
    expect(workerErr).not.toBeInstanceOf(ControlPlaneError);

    expect(cpErr).toBeInstanceOf(ControlPlaneError);
    expect(cpErr).not.toBeInstanceOf(AgentError);
    expect(cpErr).not.toBeInstanceOf(WorkerError);
  });

  it('all error types extend Error', () => {
    const errors = [
      new AgentError('A', 'test'),
      new WorkerError('W', 'test'),
      new ControlPlaneError('C', 'test'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
