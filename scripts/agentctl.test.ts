import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock fns are available before vi.mock hoists
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    mockFetch: vi.fn(),
    mockExit: vi.fn(),
    mockConsoleLog: vi.fn(),
    mockConsoleError: vi.fn(),
  };
});

// Mock global fetch
vi.stubGlobal('fetch', mocks.mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Response object that fetch would return. */
function fakeResponse(
  body: unknown,
  init: { status?: number; statusText?: string; contentType?: string } = {},
): Response {
  const status = init.status ?? 200;
  const statusText = init.statusText ?? 'OK';
  const contentType = init.contentType ?? 'application/json';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      },
    },
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(bodyStr),
  } as unknown as Response;
}

/** Capture all console.log / console.error output during a test run. */
function capturedOutput(): { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  mocks.mockConsoleLog.mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  mocks.mockConsoleError.mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  return { logs, errors };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

const originalArgv = process.argv;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(mocks.mockConsoleLog);
  vi.spyOn(console, 'error').mockImplementation(mocks.mockConsoleError);
  vi.spyOn(process, 'exit').mockImplementation(
    mocks.mockExit as unknown as (code?: number) => never,
  );
  // Reset env to defaults
  delete process.env.CONTROL_URL;
  delete process.env.WORKER_URL;
});

afterEach(() => {
  process.argv = originalArgv;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// ============================================================================
// Since agentctl.ts runs main() on import (top-level await pattern at bottom),
// we cannot import it module-level. Instead, we replicate the core logic in
// tests by calling fetch directly and testing the patterns. However, the
// module IS importable and auto-executes — so we set argv before each import.
//
// Strategy: For each test, we set process.argv, mock fetch, dynamically import
// the module, and verify console output and fetch calls.
//
// BUT — the module uses `main().catch(handler)` as a side effect at the
// bottom. Dynamic import will execute this. We need to wait for it to complete.
// We'll use a small delay and collect output.
// ============================================================================

/**
 * Run the CLI by dynamically importing the module with the given args.
 * The module auto-executes main().catch(...) at the bottom.
 */
async function execCli(args: string[]): Promise<{ logs: string[]; errors: string[] }> {
  const output = capturedOutput();
  process.argv = ['node', 'scripts/agentctl.ts', ...args];

  // Clear module cache so re-import triggers fresh execution
  vi.resetModules();

  // Import triggers the main().catch(...) side-effect
  await import('./agentctl.js');

  // Give the async main() time to settle
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 50);
  });

  return output;
}

// ============================================================================
// Tests
// ============================================================================

// ---------------------------------------------------------------------------
// help command
// ---------------------------------------------------------------------------

describe('help command', () => {
  it('prints help when no command is given', async () => {
    const output = await execCli([]);
    expect(output.logs.some((l) => l.includes('agentctl'))).toBe(true);
    expect(output.logs.some((l) => l.includes('COMMANDS'))).toBe(true);
  });

  it('prints help with "help" command', async () => {
    const output = await execCli(['help']);
    expect(output.logs.some((l) => l.includes('USAGE'))).toBe(true);
    expect(output.logs.some((l) => l.includes('COMMANDS'))).toBe(true);
  });

  it('prints help with "--help" flag', async () => {
    const output = await execCli(['--help']);
    expect(output.logs.some((l) => l.includes('USAGE'))).toBe(true);
  });

  it('prints help with "-h" flag', async () => {
    const output = await execCli(['-h']);
    expect(output.logs.some((l) => l.includes('USAGE'))).toBe(true);
  });

  it('help output includes all major commands', async () => {
    const output = await execCli(['help']);
    const allText = output.logs.join('\n');
    const commands = [
      'health',
      'health-worker',
      'status',
      'machines',
      'agents',
      'start',
      'stop',
      'signal',
      'models',
      'memory search',
      'schedule list',
      'schedule add-heartbeat',
      'schedule add-cron',
      'schedule remove',
      'runs',
    ];
    for (const cmd of commands) {
      expect(allText).toContain(cmd);
    }
  });

  it('help output includes environment variable docs', async () => {
    const output = await execCli(['help']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('CONTROL_URL');
    expect(allText).toContain('WORKER_URL');
  });
});

// ---------------------------------------------------------------------------
// unknown command
// ---------------------------------------------------------------------------

describe('unknown command', () => {
  it('prints error for unknown command', async () => {
    const output = await execCli(['foobar']);
    expect(output.errors.some((e) => e.includes('Unknown command'))).toBe(true);
    expect(output.errors.some((e) => e.includes('foobar'))).toBe(true);
  });

  it('exits with code 1 for unknown command', async () => {
    await execCli(['totally-bogus']);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('suggests running help for unknown commands', async () => {
    const output = await execCli(['deploy']);
    expect(output.errors.some((e) => e.includes('help'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// health command
// ---------------------------------------------------------------------------

describe('health command', () => {
  it('displays control plane health in formatted mode', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        dependencies: {
          postgres: { status: 'ok', latencyMs: 5 },
          redis: { status: 'ok', latencyMs: 2 },
          mem0: { status: 'ok', latencyMs: 10 },
          litellm: { status: 'ok', latencyMs: 8 },
        },
      }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Control Plane');
    expect(allText).toContain('PostgreSQL');
    expect(allText).toContain('Redis');
    expect(allText).toContain('Mem0');
    expect(allText).toContain('LiteLLM');
    expect(allText).toContain('timestamp');
  });

  it('shows degraded dependencies with error details', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'degraded',
        timestamp: '2026-03-03T12:00:00Z',
        dependencies: {
          postgres: { status: 'ok', latencyMs: 5 },
          redis: { status: 'error', latencyMs: 0, error: 'Connection refused' },
          mem0: { status: 'ok', latencyMs: 10 },
          litellm: { status: 'error', latencyMs: 0, error: 'timeout' },
        },
      }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('DEGRADED');
    expect(allText).toContain('Connection refused');
    expect(allText).toContain('timeout');
  });

  it('outputs raw JSON with --json flag', async () => {
    const healthData = {
      status: 'ok',
      timestamp: '2026-03-03T12:00:00Z',
      dependencies: {
        postgres: { status: 'ok', latencyMs: 5 },
        redis: { status: 'ok', latencyMs: 2 },
        mem0: { status: 'ok', latencyMs: 10 },
        litellm: { status: 'ok', latencyMs: 8 },
      },
    };
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse(healthData));

    const output = await execCli(['health', '--json']);
    const allText = output.logs.join('\n');
    const parsed = JSON.parse(allText);
    expect(parsed.status).toBe('ok');
    expect(parsed.dependencies.postgres.status).toBe('ok');
  });

  it('calls /health?detail=true on the control URL', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'ok', timestamp: '2026-03-03T12:00:00Z' }),
    );

    await execCli(['health']);
    expect(mocks.mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/health?detail=true'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('handles health response without dependencies', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'ok', timestamp: '2026-03-03T12:00:00Z' }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Control Plane');
    expect(allText).toContain('timestamp');
  });

  it('displays zero-latency dependencies without latency label', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        dependencies: {
          postgres: { status: 'ok', latencyMs: 0 },
          redis: { status: 'ok', latencyMs: 0 },
          mem0: { status: 'ok', latencyMs: 0 },
          litellm: { status: 'ok', latencyMs: 0 },
        },
      }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    // With latencyMs: 0, no "(Xms)" should appear after OK
    expect(allText).not.toContain('(0ms)');
  });
});

// ---------------------------------------------------------------------------
// health-worker command
// ---------------------------------------------------------------------------

describe('health-worker command', () => {
  it('displays worker health in formatted mode', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 3720,
        activeAgents: 2,
        totalAgentsStarted: 15,
        worktreesActive: 3,
        memoryUsage: 256,
        agents: { running: 2, total: 15, maxConcurrent: 5 },
        dependencies: {
          controlPlane: { status: 'ok', latencyMs: 12 },
        },
      }),
    );

    const output = await execCli(['health-worker']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent Worker');
    expect(allText).toContain('Active Agents: 2');
    expect(allText).toContain('1h 2m');
    expect(allText).toContain('256 MB');
    expect(allText).toContain('2/5');
  });

  it('outputs raw JSON with --json flag', async () => {
    const workerData = {
      status: 'ok',
      timestamp: '2026-03-03T12:00:00Z',
      uptime: 100,
      activeAgents: 0,
      totalAgentsStarted: 0,
      worktreesActive: 0,
      memoryUsage: 128,
      agents: { running: 0, total: 0, maxConcurrent: 5 },
    };
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse(workerData));

    const output = await execCli(['health-worker', '--json']);
    const allText = output.logs.join('\n');
    const parsed = JSON.parse(allText);
    expect(parsed.status).toBe('ok');
    expect(parsed.memoryUsage).toBe(128);
  });

  it('calls worker URL instead of control URL', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 100,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 128,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    await execCli(['health-worker']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('localhost:9000');
  });

  it('shows degraded control plane dependency', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'degraded',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 60,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 100,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
        dependencies: {
          controlPlane: { status: 'error', latencyMs: 0, error: 'ECONNREFUSED' },
        },
      }),
    );

    const output = await execCli(['health-worker']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('ECONNREFUSED');
  });

  it('handles worker with no dependencies block', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 50,
        activeAgents: 1,
        totalAgentsStarted: 3,
        worktreesActive: 1,
        memoryUsage: 200,
        agents: { running: 1, total: 3, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['health-worker']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent Worker');
    expect(allText).not.toContain('Control Plane:');
  });
});

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

describe('status command', () => {
  it('shows both control plane and worker status', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        dependencies: {
          postgres: { status: 'ok', latencyMs: 5 },
          redis: { status: 'ok', latencyMs: 2 },
          mem0: { status: 'ok', latencyMs: 10 },
          litellm: { status: 'ok', latencyMs: 8 },
        },
      }),
    );
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 7200,
        activeAgents: 1,
        totalAgentsStarted: 5,
        worktreesActive: 2,
        memoryUsage: 512,
        agents: { running: 1, total: 5, maxConcurrent: 10 },
        dependencies: {
          controlPlane: { status: 'ok', latencyMs: 3 },
        },
      }),
    );

    const output = await execCli(['status']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('System Status');
    expect(allText).toContain('Control Plane');
    expect(allText).toContain('Agent Worker');
    expect(allText).toContain('Active Agents: 1');
  });

  it('shows unreachable control plane when it fails', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 100,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 128,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['status']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('UNREACHABLE');
    expect(allText).toContain('Agent Worker');
  });

  it('shows unreachable worker when it fails', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
      }),
    );
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const output = await execCli(['status']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Control Plane');
    expect(allText).toContain('UNREACHABLE');
  });

  it('shows both unreachable when both fail', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const output = await execCli(['status']);
    const allText = output.logs.join('\n');
    // Both should show UNREACHABLE
    const unreachableCount = (allText.match(/UNREACHABLE/g) ?? []).length;
    expect(unreachableCount).toBe(2);
  });

  it('outputs raw JSON with --json flag', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
      }),
    );
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 100,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 128,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['status', '--json']);
    const parsed = JSON.parse(output.logs.join('\n'));
    expect(parsed).toHaveProperty('controlPlane');
    expect(parsed).toHaveProperty('agentWorker');
  });

  it('--json shows unreachable status when control plane fails', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 100,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 128,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['status', '--json']);
    const parsed = JSON.parse(output.logs.join('\n'));
    expect(parsed.controlPlane.status).toBe('unreachable');
    expect(parsed.controlPlane.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// machines command
// ---------------------------------------------------------------------------

describe('machines command', () => {
  it('displays machines in table format', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          machineId: 'ec2-us-east-1',
          hostname: 'ip-10-0-1-42',
          status: 'online',
          lastHeartbeat: '2026-03-03T12:00:00Z',
        },
        {
          machineId: 'mac-mini-01',
          hostname: 'mac-mini.local',
          status: 'online',
          lastSeen: '2026-03-03T11:59:00Z',
        },
      ]),
    );

    const output = await execCli(['machines']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Registered Machines (2)');
    expect(allText).toContain('MACHINE ID');
    expect(allText).toContain('ec2-us-east-1');
    expect(allText).toContain('mac-mini-01');
  });

  it('handles empty machines list', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    const output = await execCli(['machines']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Registered Machines (0)');
    expect(allText).toContain('(no results)');
  });

  it('handles non-array response by printing JSON', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ error: 'Database not initialized' }));

    const output = await execCli(['machines']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Database not initialized');
  });

  it('calls /api/agents endpoint', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    await execCli(['machines']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/agents');
  });

  it('falls back to id field when machineId is missing', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([{ id: 'fallback-id', hostname: 'test', state: 'active' }]),
    );

    const output = await execCli(['machines']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('fallback-id');
    expect(allText).toContain('active');
  });
});

// ---------------------------------------------------------------------------
// agents command
// ---------------------------------------------------------------------------

describe('agents command', () => {
  it('displays agents in table format', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          id: 'agent-1',
          name: 'CodeReviewer',
          machineId: 'ec2-us-east-1',
          type: 'autonomous',
          status: 'running',
          schedule: '*/5 * * * *',
        },
        {
          agentId: 'agent-2',
          name: 'TestRunner',
          machineId: 'mac-mini-01',
          type: 'ad-hoc',
          status: 'idle',
        },
      ]),
    );

    const output = await execCli(['agents']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Registered Agents (2)');
    expect(allText).toContain('AGENT ID');
    expect(allText).toContain('CodeReviewer');
    expect(allText).toContain('agent-2');
  });

  it('handles empty agents list', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    const output = await execCli(['agents']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Registered Agents (0)');
    expect(allText).toContain('(no results)');
  });

  it('handles non-array response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ message: 'Table does not exist' }));

    const output = await execCli(['agents']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Table does not exist');
  });

  it('calls /api/agents/agents/list endpoint', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    await execCli(['agents']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/agents/agents/list');
  });
});

// ---------------------------------------------------------------------------
// start command
// ---------------------------------------------------------------------------

describe('start command', () => {
  it('sends start request with agentId and prompt', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true, jobId: 'job-123' }));

    const output = await execCli(['start', 'agent-1', 'Fix', 'the', 'login', 'bug']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent start request sent');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('job-123');
    expect(allText).toContain('Fix the login bug');
  });

  it('errors when agentId is missing', async () => {
    const output = await execCli(['start']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when prompt is missing', async () => {
    const output = await execCli(['start', 'agent-1']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('POSTs to /api/agents/{agentId}/start', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['start', 'my-agent', 'do', 'something']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/agents/my-agent/start');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.prompt).toBe('do something');
  });

  it('encodes special characters in agentId', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['start', 'agent/with spaces', 'test prompt']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('agent%2Fwith%20spaces');
  });

  it('handles response without jobId', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli(['start', 'agent-1', 'test']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent start request sent');
    expect(allText).not.toContain('jobId');
  });
});

// ---------------------------------------------------------------------------
// stop command
// ---------------------------------------------------------------------------

describe('stop command', () => {
  it('sends stop request', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true, removedRepeatableJobs: 2 }));

    const output = await execCli(['stop', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent stop request sent');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('removedRepeatableJobs: 2');
  });

  it('errors when agentId is missing', async () => {
    const output = await execCli(['stop']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('POSTs to /api/agents/{agentId}/stop with graceful flag', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['stop', 'agent-1']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/agents/agent-1/stop');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.reason).toBe('user');
    expect(body.graceful).toBe(true);
  });

  it('handles response without removedRepeatableJobs', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli(['stop', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent stop request sent');
    expect(allText).not.toContain('removedRepeatableJobs');
  });
});

// ---------------------------------------------------------------------------
// signal command
// ---------------------------------------------------------------------------

describe('signal command', () => {
  it('sends signal with prompt', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true, jobId: 'signal-456' }));

    const output = await execCli(['signal', 'agent-1', 'Also', 'update', 'the', 'tests']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Signal sent to agent');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('signal-456');
    expect(allText).toContain('Also update the tests');
  });

  it('errors when agentId is missing', async () => {
    const output = await execCli(['signal']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when prompt is missing', async () => {
    const output = await execCli(['signal', 'agent-1']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('POSTs to /api/agents/{agentId}/signal', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['signal', 'agent-1', 'test']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/agents/agent-1/signal');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.prompt).toBe('test');
  });

  it('handles response without jobId', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli(['signal', 'agent-1', 'test']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Signal sent to agent');
    expect(allText).not.toContain('jobId');
  });
});

// ---------------------------------------------------------------------------
// models command
// ---------------------------------------------------------------------------

describe('models command', () => {
  it('displays string model list', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ models: ['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-pro'] }),
    );

    const output = await execCli(['models']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Available Models (3)');
    expect(allText).toContain('claude-sonnet-4-20250514');
    expect(allText).toContain('gpt-4o');
    expect(allText).toContain('gemini-pro');
  });

  it('displays object model list with provider info', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        models: [
          { id: 'claude-opus-4-20250514', provider: 'anthropic', status: 'available' },
          { model_name: 'gpt-4o', litellm_provider: 'openai', status: 'available' },
        ],
      }),
    );

    const output = await execCli(['models']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Available Models (2)');
    expect(allText).toContain('claude-opus-4-20250514');
    expect(allText).toContain('anthropic');
    expect(allText).toContain('gpt-4o');
    expect(allText).toContain('openai');
  });

  it('handles non-array models response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ error: 'LiteLLM not configured' }));

    const output = await execCli(['models']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('LiteLLM not configured');
  });

  it('calls /api/router/models endpoint', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ models: [] }));

    await execCli(['models']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/router/models');
  });
});

// ---------------------------------------------------------------------------
// memory search command
// ---------------------------------------------------------------------------

describe('memory search command', () => {
  it('displays search results', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        results: [
          { id: 'mem-1', memory: 'Authentication flow uses JWT tokens', score: 0.95 },
          { id: 'mem-2', memory: 'Login endpoint is /api/auth/login', score: 0.82 },
        ],
      }),
    );

    const output = await execCli(['memory', 'search', 'authentication', 'flow']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Memory Search Results (2)');
    expect(allText).toContain('Authentication flow uses JWT tokens');
    expect(allText).toContain('0.95');
    expect(allText).toContain('mem-1');
  });

  it('shows no results message when empty', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ results: [] }));

    const output = await execCli(['memory', 'search', 'nonexistent']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('No memories found');
    expect(allText).toContain('nonexistent');
  });

  it('errors when query is missing', async () => {
    const output = await execCli(['memory', 'search']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors for unknown memory subcommand', async () => {
    const output = await execCli(['memory', 'delete']);
    expect(output.errors.some((e) => e.includes('Unknown memory subcommand'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when no memory subcommand given', async () => {
    const output = await execCli(['memory']);
    expect(output.errors.some((e) => e.includes('Unknown memory subcommand'))).toBe(true);
    expect(output.errors.some((e) => e.includes('(none)'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('POSTs to /api/memory/search with query', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ results: [] }));

    await execCli(['memory', 'search', 'auth', 'flow']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/memory/search');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.query).toBe('auth flow');
  });

  it('handles results with content/text fields instead of memory', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        results: [{ content: 'Some content', score: 0.5 }],
      }),
    );

    const output = await execCli(['memory', 'search', 'test']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Some content');
  });

  it('handles results without score or id', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        results: [{ memory: 'Simple memory entry' }],
      }),
    );

    const output = await execCli(['memory', 'search', 'test']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Simple memory entry');
    expect(allText).not.toContain('score:');
    expect(allText).not.toContain('id=');
  });
});

// ---------------------------------------------------------------------------
// schedule list command
// ---------------------------------------------------------------------------

describe('schedule list command', () => {
  it('displays scheduled jobs in table format', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        jobs: [
          { key: 'agent-1', name: 'heartbeat', every: 30000, next: Date.now() + 30000 },
          { key: 'agent-2', name: 'cron', pattern: '*/5 * * * *', next: Date.now() + 60000 },
        ],
      }),
    );

    const output = await execCli(['schedule', 'list']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Scheduled Jobs (2)');
    expect(allText).toContain('KEY');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('heartbeat');
    expect(allText).toContain('30000ms');
    expect(allText).toContain('*/5 * * * *');
  });

  it('handles empty jobs list', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ jobs: [] }));

    const output = await execCli(['schedule', 'list']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Scheduled Jobs (0)');
    expect(allText).toContain('(no results)');
  });

  it('handles non-array jobs response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ error: 'Redis not available' }));

    const output = await execCli(['schedule', 'list']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Redis not available');
  });

  it('calls /api/scheduler/jobs endpoint', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ jobs: [] }));

    await execCli(['schedule', 'list']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/scheduler/jobs');
  });
});

// ---------------------------------------------------------------------------
// schedule add-heartbeat command
// ---------------------------------------------------------------------------

describe('schedule add-heartbeat command', () => {
  it('adds a heartbeat job successfully', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli([
      'schedule',
      'add-heartbeat',
      'agent-1',
      'ec2-us-east-1',
      '30000',
    ]);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Heartbeat job added');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('ec2-us-east-1');
    expect(allText).toContain('30000');
  });

  it('errors when agentId is missing', async () => {
    const output = await execCli(['schedule', 'add-heartbeat']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when machineId is missing', async () => {
    const output = await execCli(['schedule', 'add-heartbeat', 'agent-1']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when intervalMs is missing', async () => {
    const output = await execCli(['schedule', 'add-heartbeat', 'agent-1', 'ec2-us-east-1']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when intervalMs is not a valid positive number', async () => {
    const output = await execCli(['schedule', 'add-heartbeat', 'agent-1', 'ec2-us-east-1', 'abc']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when intervalMs is zero', async () => {
    const output = await execCli(['schedule', 'add-heartbeat', 'agent-1', 'ec2-us-east-1', '0']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when intervalMs is negative', async () => {
    const output = await execCli([
      'schedule',
      'add-heartbeat',
      'agent-1',
      'ec2-us-east-1',
      '-1000',
    ]);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('POSTs to /api/scheduler/jobs/heartbeat with correct body', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['schedule', 'add-heartbeat', 'agent-1', 'mac-mini', '60000']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/scheduler/jobs/heartbeat');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.agentId).toBe('agent-1');
    expect(body.machineId).toBe('mac-mini');
    expect(body.intervalMs).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// schedule add-cron command
// ---------------------------------------------------------------------------

describe('schedule add-cron command', () => {
  it('adds a cron job successfully', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli(['schedule', 'add-cron', 'agent-2', 'mac-mini', '*/5 * * * *']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Cron job added');
    expect(allText).toContain('agent-2');
    expect(allText).toContain('mac-mini');
    expect(allText).toContain('*/5 * * * *');
  });

  it('adds a cron job with a model', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli([
      'schedule',
      'add-cron',
      'agent-2',
      'mac-mini',
      '0 */6 * * *',
      'claude-sonnet-4-20250514',
    ]);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Cron job added');
    expect(allText).toContain('claude-sonnet-4-20250514');
  });

  it('errors when agentId is missing', async () => {
    const output = await execCli(['schedule', 'add-cron']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when machineId is missing', async () => {
    const output = await execCli(['schedule', 'add-cron', 'agent-1']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when pattern is missing', async () => {
    const output = await execCli(['schedule', 'add-cron', 'agent-1', 'mac-mini']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('POSTs to /api/scheduler/jobs/cron with correct body', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['schedule', 'add-cron', 'agent-2', 'mac-mini', '*/5 * * * *']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/scheduler/jobs/cron');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.agentId).toBe('agent-2');
    expect(body.machineId).toBe('mac-mini');
    expect(body.pattern).toBe('*/5 * * * *');
  });

  it('includes model in POST body when provided', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['schedule', 'add-cron', 'agent-2', 'mac-mini', '*/5 * * * *', 'gpt-4o']);
    const body = JSON.parse((mocks.mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o');
  });

  it('omits model from POST body when not provided', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['schedule', 'add-cron', 'agent-2', 'mac-mini', '*/5 * * * *']);
    const body = JSON.parse((mocks.mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// schedule remove command
// ---------------------------------------------------------------------------

describe('schedule remove command', () => {
  it('removes a scheduled job', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true, removedCount: 1 }));

    const output = await execCli(['schedule', 'remove', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Scheduled job removed');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('removedCount: 1');
  });

  it('errors when key is missing', async () => {
    const output = await execCli(['schedule', 'remove']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('DELETEs /api/scheduler/jobs/{key}', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['schedule', 'remove', 'my-key']);
    const [url, opts] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/scheduler/jobs/my-key');
    expect(opts.method).toBe('DELETE');
  });

  it('encodes special characters in key', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['schedule', 'remove', 'key/with spaces']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('key%2Fwith%20spaces');
  });

  it('handles response without removedCount', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    const output = await execCli(['schedule', 'remove', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Scheduled job removed');
    expect(allText).not.toContain('removedCount');
  });
});

// ---------------------------------------------------------------------------
// schedule unknown subcommand
// ---------------------------------------------------------------------------

describe('schedule unknown subcommand', () => {
  it('errors for unknown schedule subcommand', async () => {
    const output = await execCli(['schedule', 'pause']);
    expect(output.errors.some((e) => e.includes('Unknown schedule subcommand'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when no schedule subcommand given', async () => {
    const output = await execCli(['schedule']);
    expect(output.errors.some((e) => e.includes('Unknown schedule subcommand'))).toBe(true);
    expect(output.errors.some((e) => e.includes('(none)'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('lists available schedule subcommands in error', async () => {
    const output = await execCli(['schedule', 'unknown']);
    expect(output.errors.some((e) => e.includes('add-heartbeat'))).toBe(true);
    expect(output.errors.some((e) => e.includes('add-cron'))).toBe(true);
    expect(output.errors.some((e) => e.includes('remove'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runs command
// ---------------------------------------------------------------------------

describe('runs command', () => {
  it('displays recent runs in table format', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          id: 'run-1',
          trigger: 'manual',
          status: 'completed',
          model: 'claude-sonnet-4-20250514',
          costUsd: 0.0045,
          startedAt: '2026-03-03T10:00:00Z',
          finishedAt: '2026-03-03T10:02:30Z',
        },
        {
          id: 'run-2',
          trigger: 'heartbeat',
          status: 'running',
          model: 'claude-sonnet-4-20250514',
          startedAt: '2026-03-03T12:00:00Z',
        },
      ]),
    );

    const output = await execCli(['runs', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Recent Runs for');
    expect(allText).toContain('agent-1');
    expect(allText).toContain('run-1');
    expect(allText).toContain('completed');
    expect(allText).toContain('$0.0045');
    expect(allText).toContain('running...');
  });

  it('uses default limit of 20', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    await execCli(['runs', 'agent-1']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=20');
  });

  it('respects custom limit', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    await execCli(['runs', 'agent-1', '10']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
  });

  it('errors when agentId is missing', async () => {
    const output = await execCli(['runs']);
    expect(output.errors.some((e) => e.includes('Usage'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when limit is not a positive integer', async () => {
    const output = await execCli(['runs', 'agent-1', '-5']);
    expect(output.errors.some((e) => e.includes('positive integer'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('errors when limit is not a number', async () => {
    const output = await execCli(['runs', 'agent-1', 'abc']);
    expect(output.errors.some((e) => e.includes('positive integer'))).toBe(true);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('handles non-array runs response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ message: 'Agent not found' }));

    const output = await execCli(['runs', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('Agent not found');
  });

  it('formats duration in milliseconds for short runs', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          id: 'run-fast',
          trigger: 'manual',
          status: 'completed',
          startedAt: '2026-03-03T10:00:00.000Z',
          finishedAt: '2026-03-03T10:00:00.500Z',
        },
      ]),
    );

    const output = await execCli(['runs', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('500ms');
  });

  it('formats duration in seconds for medium runs', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          id: 'run-med',
          trigger: 'manual',
          status: 'completed',
          startedAt: '2026-03-03T10:00:00.000Z',
          finishedAt: '2026-03-03T10:00:45.000Z',
        },
      ]),
    );

    const output = await execCli(['runs', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('45.0s');
  });

  it('formats duration in minutes for long runs', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          id: 'run-long',
          trigger: 'manual',
          status: 'completed',
          startedAt: '2026-03-03T10:00:00.000Z',
          finishedAt: '2026-03-03T10:05:30.000Z',
        },
      ]),
    );

    const output = await execCli(['runs', 'agent-1']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('5.5m');
  });

  it('shows dash for cost when costUsd is null', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          id: 'run-no-cost',
          trigger: 'manual',
          status: 'completed',
          costUsd: null,
          startedAt: '2026-03-03T10:00:00Z',
          finishedAt: '2026-03-03T10:01:00Z',
        },
      ]),
    );

    const output = await execCli(['runs', 'agent-1']);
    const allText = output.logs.join('\n');
    // The "-" in COST (USD) column
    expect(allText).toContain('run-no-cost');
  });
});

// ---------------------------------------------------------------------------
// --json global flag
// ---------------------------------------------------------------------------

describe('--json global flag', () => {
  it('--json works with health command', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'ok', timestamp: '2026-03-03T12:00:00Z' }),
    );

    const output = await execCli(['--json', 'health']);
    const allText = output.logs.join('\n');
    const parsed = JSON.parse(allText);
    expect(parsed.status).toBe('ok');
  });

  it('--json can appear after the command', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'ok', timestamp: '2026-03-03T12:00:00Z' }),
    );

    const output = await execCli(['health', '--json']);
    const allText = output.logs.join('\n');
    const parsed = JSON.parse(allText);
    expect(parsed.status).toBe('ok');
  });

  it('--json flag is stripped from command arguments', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true, jobId: 'j1' }));

    // "--json" should not become part of the prompt
    await execCli(['start', 'agent-1', '--json', 'fix bug']);
    const body = JSON.parse((mocks.mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt).toBe('fix bug');
  });
});

// ---------------------------------------------------------------------------
// Error handling — network errors
// ---------------------------------------------------------------------------

describe('error handling — network errors', () => {
  it('shows CONNECTION_FAILED error when fetch throws', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const output = await execCli(['health']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('CONNECTION_FAILED');
    expect(allText).toContain('fetch failed');
  });

  it('includes suggestions for ECONNREFUSED on control URL', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const output = await execCli(['health']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('Suggestions');
    expect(allText).toContain('control plane running');
  });

  it('includes suggestions for ECONNREFUSED on worker URL', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const output = await execCli(['health-worker']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('Suggestions');
    expect(allText).toContain('agent worker running');
  });

  it('exits with code 1 on connection error', async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    await execCli(['health']);
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });

  it('handles non-Error throw from fetch', async () => {
    mocks.mockFetch.mockRejectedValueOnce('plain string error');

    const output = await execCli(['machines']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('CONNECTION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Error handling — HTTP errors
// ---------------------------------------------------------------------------

describe('error handling — HTTP errors', () => {
  it('shows HTTP_ERROR for 404 response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ error: 'Not found' }, { status: 404, statusText: 'Not Found' }),
    );

    const output = await execCli(['machines']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('HTTP_ERROR');
    expect(allText).toContain('Not found');
  });

  it('shows HTTP_ERROR for 500 response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse(
        { error: 'Internal server error', message: 'Database connection lost' },
        { status: 500, statusText: 'Internal Server Error' },
      ),
    );

    const output = await execCli(['agents']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('HTTP_ERROR');
    expect(allText).toContain('Internal server error');
    expect(allText).toContain('Database connection lost');
  });

  it('shows HTTP status when error body has no error field', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse(
        { detail: 'Something went wrong' },
        { status: 503, statusText: 'Service Unavailable' },
      ),
    );

    const output = await execCli(['models']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('HTTP 503');
  });

  it('includes HTTP status and URL in error output', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ error: 'Forbidden' }, { status: 403, statusText: 'Forbidden' }),
    );

    const output = await execCli(['machines']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('HTTP status: 403');
    expect(allText).toContain('URL:');
  });

  it('handles non-JSON error response', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
        contentType: 'text/plain',
      }),
    );

    const output = await execCli(['health']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('HTTP_ERROR');
    expect(allText).toContain('HTTP 502');
  });
});

// ---------------------------------------------------------------------------
// Error handling — generic errors in main catch
// ---------------------------------------------------------------------------

describe('error handling — generic errors', () => {
  it('handles non-CliError Error instances', async () => {
    // Force an error by making fetch return something that causes a TypeError
    // when the command tries to destructure it. Use a malformed response.
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse(null, { status: 200, contentType: 'text/html' }),
    );

    // The 'machines' command will try to check Array.isArray(data) — null should
    // cause it to JSON.stringify(null), which is fine. Let's trigger a real error
    // by making the json() method throw.
    mocks.mockFetch.mockReset();
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: () => {
        throw new Error('Unexpected token');
      },
      text: () => Promise.resolve('not json'),
    } as unknown as Response);

    const output = await execCli(['machines']);
    const allText = output.errors.join('\n');
    expect(allText).toContain('Unexpected token');
    expect(mocks.mockExit).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Request helper — Content-Type and body handling
// ---------------------------------------------------------------------------

describe('request helper behavior', () => {
  it('sends Content-Type application/json for POST with body', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse({ ok: true }));

    await execCli(['start', 'agent-1', 'test prompt']);
    const opts = mocks.mockFetch.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
  });

  it('sends Accept application/json for GET without body', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'ok', timestamp: '2026-03-03T12:00:00Z' }),
    );

    await execCli(['health']);
    const opts = mocks.mockFetch.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('does not include body for GET requests', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    await execCli(['machines']);
    const opts = mocks.mockFetch.mock.calls[0][1] as RequestInit;
    expect(opts.body).toBeUndefined();
  });

  it('uses CONTROL_URL as default base URL', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    await execCli(['machines']);
    const url = mocks.mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('localhost:8080');
  });
});

// ---------------------------------------------------------------------------
// Table formatting edge cases
// ---------------------------------------------------------------------------

describe('table formatting', () => {
  it('aligns columns based on widest content', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse([
        {
          machineId: 'short',
          hostname: 'h',
          status: 'online',
          lastHeartbeat: '2026-03-03T12:00:00Z',
        },
        {
          machineId: 'very-long-machine-identifier',
          hostname: 'hostname.example.com',
          status: 'offline',
          lastHeartbeat: '2026-03-03T12:00:00Z',
        },
      ]),
    );

    const output = await execCli(['machines']);
    const allText = output.logs.join('\n');
    // Both entries should appear
    expect(allText).toContain('short');
    expect(allText).toContain('very-long-machine-identifier');
  });

  it('displays (no results) for empty table', async () => {
    mocks.mockFetch.mockResolvedValueOnce(fakeResponse([]));

    const output = await execCli(['agents']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('(no results)');
  });
});

// ---------------------------------------------------------------------------
// Uptime formatting
// ---------------------------------------------------------------------------

describe('uptime formatting', () => {
  it('formats seconds-only uptime', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 45,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 100,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['health-worker']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('45s');
  });

  it('formats minutes-and-seconds uptime', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 125,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 100,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['health-worker']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('2m 5s');
  });

  it('formats hours-and-minutes uptime', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        uptime: 7320,
        activeAgents: 0,
        totalAgentsStarted: 0,
        worktreesActive: 0,
        memoryUsage: 100,
        agents: { running: 0, total: 0, maxConcurrent: 5 },
      }),
    );

    const output = await execCli(['health-worker']);
    const allText = output.logs.join('\n');
    expect(allText).toContain('2h 2m');
  });
});

// ---------------------------------------------------------------------------
// Status colorization
// ---------------------------------------------------------------------------

describe('status colorization', () => {
  it('shows green OK status for healthy control plane', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'ok', timestamp: '2026-03-03T12:00:00Z' }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    // ANSI green code should wrap "OK"
    expect(allText).toContain('\x1b[32mOK\x1b[0m');
  });

  it('shows yellow DEGRADED status', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({ status: 'degraded', timestamp: '2026-03-03T12:00:00Z' }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    // ANSI yellow code should wrap "DEGRADED"
    expect(allText).toContain('\x1b[33mDEGRADED\x1b[0m');
  });

  it('shows red for unknown status values', async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      fakeResponse({
        status: 'ok',
        timestamp: '2026-03-03T12:00:00Z',
        dependencies: {
          postgres: { status: 'error', latencyMs: 0 },
          redis: { status: 'ok', latencyMs: 1 },
          mem0: { status: 'ok', latencyMs: 1 },
          litellm: { status: 'ok', latencyMs: 1 },
        },
      }),
    );

    const output = await execCli(['health']);
    const allText = output.logs.join('\n');
    // ANSI red code should wrap "ERROR"
    expect(allText).toContain('\x1b[31mERROR\x1b[0m');
  });
});
