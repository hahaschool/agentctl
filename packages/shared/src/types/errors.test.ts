import { describe, expect, it } from 'vitest';

import { AgentError, ControlPlaneError, WorkerError } from './errors.js';

// ── AgentError ──────────────────────────────────────────────────────

describe('AgentError', () => {
  it('sets name to AgentError', () => {
    const error = new AgentError('TEST_CODE', 'test message');
    expect(error.name).toBe('AgentError');
  });

  it('stores code and message', () => {
    const error = new AgentError('AGENT_TIMEOUT', 'Agent did not respond within 60s');
    expect(error.code).toBe('AGENT_TIMEOUT');
    expect(error.message).toBe('Agent did not respond within 60s');
  });

  it('stores optional context when provided', () => {
    const ctx = { agentId: 'a1', timeout: 60 };
    const error = new AgentError('AGENT_TIMEOUT', 'timed out', ctx);
    expect(error.context).toEqual({ agentId: 'a1', timeout: 60 });
  });

  it('leaves context undefined when not provided', () => {
    const error = new AgentError('UNKNOWN', 'something broke');
    expect(error.context).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const error = new AgentError('CODE', 'msg');
    expect(error).toBeInstanceOf(Error);
  });

  it('can be caught in try/catch and identified via instanceof', () => {
    let caught: unknown;
    try {
      throw new AgentError('AGENT_CRASH', 'process exited', { exitCode: 1 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(AgentError);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(WorkerError);
    expect(caught).not.toBeInstanceOf(ControlPlaneError);

    if (caught instanceof AgentError) {
      expect(caught.code).toBe('AGENT_CRASH');
      expect(caught.message).toBe('process exited');
      expect(caught.context).toEqual({ exitCode: 1 });
    }
  });
});

// ── WorkerError ─────────────────────────────────────────────────────

describe('WorkerError', () => {
  it('sets name to WorkerError', () => {
    const error = new WorkerError('TEST_CODE', 'test message');
    expect(error.name).toBe('WorkerError');
  });

  it('stores code and message', () => {
    const error = new WorkerError('WORKER_OVERLOADED', 'Too many agents running');
    expect(error.code).toBe('WORKER_OVERLOADED');
    expect(error.message).toBe('Too many agents running');
  });

  it('stores optional context when provided', () => {
    const ctx = { machineId: 'm1', currentLoad: 8 };
    const error = new WorkerError('WORKER_OVERLOADED', 'overloaded', ctx);
    expect(error.context).toEqual({ machineId: 'm1', currentLoad: 8 });
  });

  it('leaves context undefined when not provided', () => {
    const error = new WorkerError('DISCONNECTED', 'lost connection');
    expect(error.context).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const error = new WorkerError('CODE', 'msg');
    expect(error).toBeInstanceOf(Error);
  });

  it('can be caught in try/catch and identified via instanceof', () => {
    let caught: unknown;
    try {
      throw new WorkerError('SPAWN_FAILED', 'could not start agent process', {
        machineId: 'mac-mini-01',
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(WorkerError);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(AgentError);
    expect(caught).not.toBeInstanceOf(ControlPlaneError);

    if (caught instanceof WorkerError) {
      expect(caught.code).toBe('SPAWN_FAILED');
      expect(caught.message).toBe('could not start agent process');
      expect(caught.context).toEqual({ machineId: 'mac-mini-01' });
    }
  });
});

// ── ControlPlaneError ───────────────────────────────────────────────

describe('ControlPlaneError', () => {
  it('sets name to ControlPlaneError', () => {
    const error = new ControlPlaneError('TEST_CODE', 'test message');
    expect(error.name).toBe('ControlPlaneError');
  });

  it('stores code and message', () => {
    const error = new ControlPlaneError(
      'DB_CONNECTION_FAILED',
      'Cannot connect to PostgreSQL',
    );
    expect(error.code).toBe('DB_CONNECTION_FAILED');
    expect(error.message).toBe('Cannot connect to PostgreSQL');
  });

  it('stores optional context when provided', () => {
    const ctx = { host: 'localhost', port: 5432 };
    const error = new ControlPlaneError('DB_CONNECTION_FAILED', 'connection refused', ctx);
    expect(error.context).toEqual({ host: 'localhost', port: 5432 });
  });

  it('leaves context undefined when not provided', () => {
    const error = new ControlPlaneError('SCHEDULER_FAILED', 'BullMQ unavailable');
    expect(error.context).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const error = new ControlPlaneError('CODE', 'msg');
    expect(error).toBeInstanceOf(Error);
  });

  it('can be caught in try/catch and identified via instanceof', () => {
    let caught: unknown;
    try {
      throw new ControlPlaneError('AUTH_FAILED', 'invalid token', {
        endpoint: '/api/agents',
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ControlPlaneError);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(AgentError);
    expect(caught).not.toBeInstanceOf(WorkerError);

    if (caught instanceof ControlPlaneError) {
      expect(caught.code).toBe('AUTH_FAILED');
      expect(caught.message).toBe('invalid token');
      expect(caught.context).toEqual({ endpoint: '/api/agents' });
    }
  });
});

// ── Cross-class differentiation ─────────────────────────────────────

describe('Error type differentiation', () => {
  it('instanceof checks distinguish between all three error types', () => {
    const agentErr = new AgentError('A', 'agent error');
    const workerErr = new WorkerError('W', 'worker error');
    const cpErr = new ControlPlaneError('C', 'control plane error');

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

  it('all three types extend Error', () => {
    const errors = [
      new AgentError('A', 'test'),
      new WorkerError('W', 'test'),
      new ControlPlaneError('C', 'test'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('a catch block can route errors by type', () => {
    const errors = [
      new AgentError('A_CODE', 'agent msg'),
      new WorkerError('W_CODE', 'worker msg'),
      new ControlPlaneError('CP_CODE', 'cp msg'),
    ];

    const routed: string[] = [];

    for (const err of errors) {
      try {
        throw err;
      } catch (e) {
        if (e instanceof AgentError) {
          routed.push(`agent:${e.code}`);
        } else if (e instanceof WorkerError) {
          routed.push(`worker:${e.code}`);
        } else if (e instanceof ControlPlaneError) {
          routed.push(`cp:${e.code}`);
        }
      }
    }

    expect(routed).toEqual(['agent:A_CODE', 'worker:W_CODE', 'cp:CP_CODE']);
  });
});
